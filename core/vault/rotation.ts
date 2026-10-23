// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { followingOccurrence, nextOccurrence } from "../policy/recurrence.ts";

export const rotationSteps = [
	"capture",
	"verify_candidate",
	"install_consumer",
	"verify_consumer",
	"promote",
	"revoke_previous",
] as const;
export type RotationStep = (typeof rotationSteps)[number];
export const rotationRecord = z
	.looseObject({
		operationId: z.string().min(1).max(200),
		credentialId: z.uuid(),
		connectionId: z.uuid(),
		candidateId: z.uuid(),
		previousId: z.uuid(),
		policyRevision: z.int().positive(),
		recipe: z.string().min(1).max(100),
		consumer: z.string().min(1).max(100),
		step: z.int().min(0).max(rotationSteps.length),
		revision: z.int().nonnegative(),
		status: z.enum([
			"ready",
			"running",
			"complete",
			"needs_attention",
			"paused",
			"unsupported",
		]),
	})
	.refine(
		(r) => r.candidateId !== r.previousId,
		"candidate must differ from previous",
	)
	.refine(
		(r) => (r.status === "complete") === (r.step === rotationSteps.length),
		"invalid progress",
	);
export type Rotation = z.infer<typeof rotationRecord>;
const zone = z
	.string()
	.max(100)
	.refine((value) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: value });
			return true;
		} catch {
			return false;
		}
	});
export const dailyRotationInput = z.strictObject({
	enabled: z.boolean(),
	time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
	timeZone: zone,
	recipe: z.string().min(1).max(100),
	consumer: z.string().min(1).max(100),
});
export const dailyRotationRecord = dailyRotationInput.loose().extend({
	credentialId: z.uuid(),
	revision: z.int().positive(),
	nextAt: z.iso.datetime(),
	activeOperationId: z.string().min(1).max(200).optional(),
});
export type DailyRotation = z.infer<typeof dailyRotationRecord>;
export function nextDailyRotation(
	policy: Pick<DailyRotation, "time" | "timeZone">,
	now: Date,
	due?: Date,
) {
	const recurrence = { rule: "daily" as const, time: policy.time };
	return (
		due
			? followingOccurrence(recurrence, due, now, policy.timeZone)
			: nextOccurrence(recurrence, now, policy.timeZone)
	).toISOString();
}
export interface RotationStore {
	get(): Promise<Rotation>;
	/** Atomically compare revision and immutable operation binding, then persist the new receipt. */
	compareAndSet(before: Rotation, after: Rotation): Promise<boolean>;
}
export type RotationOutcome = "done" | "refused" | "uncertain";
export interface RotationDriver {
	supported(rotation: Rotation): Promise<boolean>;
	/** Recheck opt-in, account binding, rollout and spending admission before every step. */
	authorized(rotation: Rotation, step: RotationStep): Promise<boolean>;
	execute(rotation: Rotation, step: RotationStep): Promise<RotationOutcome>;
	/** Read-only proof of this exact step, including its postcondition; never repeats a mutation. */
	observe(rotation: Rotation, step: RotationStep): Promise<"done" | "unknown">;
}
const advanced = (record: Rotation): Rotation => ({
	...record,
	revision: record.revision + 1,
	step: record.step + 1,
	status: record.step + 1 === rotationSteps.length ? "complete" : "ready",
});

/** A receipt is committed before each effect. An interrupted effect is never dispatched again. */
export async function runRotation(
	store: RotationStore,
	driver: RotationDriver,
): Promise<Rotation> {
	for (;;) {
		const record = rotationRecord.parse(await store.get());
		if (record.status !== "ready") return record;
		const step = rotationSteps[record.step];
		if (!step) throw new Error("invalid rotation progress");
		const status = !(await driver.supported(record))
			? "unsupported"
			: !(await driver.authorized(record, step))
				? "paused"
				: "running";
		const claimed: Rotation = {
			...record,
			revision: record.revision + 1,
			status,
		};
		if (!(await store.compareAndSet(record, claimed))) return store.get();
		if (status !== "running") return claimed;
		let outcome: RotationOutcome;
		try {
			outcome = await driver.execute(claimed, step);
		} catch {
			outcome = "uncertain";
		}
		const after: Rotation =
			outcome === "done"
				? advanced(claimed)
				: {
						...claimed,
						revision: claimed.revision + 1,
						status: "needs_attention",
					};
		if (!(await store.compareAndSet(claimed, after))) return store.get();
		if (after.status !== "ready") return after;
	}
}

/** Explicit reconciliation requires observed proof; a timeout or negative result cannot advance. */
export async function reconcileRotation(
	store: RotationStore,
	driver: RotationDriver,
): Promise<Rotation> {
	const record = rotationRecord.parse(await store.get());
	const step = rotationSteps[record.step];
	if (!step || !["running", "needs_attention"].includes(record.status))
		return record;
	if (
		!(await driver.supported(record)) ||
		!(await driver.authorized(record, step))
	)
		return record;
	let observed: "done" | "unknown";
	try {
		observed = await driver.observe(record, step);
	} catch {
		return record;
	}
	if (observed === "done") await store.compareAndSet(record, advanced(record));
	return store.get();
}
