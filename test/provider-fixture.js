// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Serve the same deterministic fixture over the provider's actual streaming protocol.
export function streamingResponse(res, request) {
  if (!request.stream) return;
  const end = res.end.bind(res);
  res.end = body => {
    if (res.statusCode >= 400) return end(body);
    let value;
    try { value = JSON.parse(body); } catch { return end(body); }
    const events = [];
    if (value.output) {
      events.push({ type: 'response.created', response: { ...value, output: [], status: 'in_progress' } });
      value.output.forEach((item, output_index) => events.push(
        { type: 'response.output_item.added', output_index, item },
        { type: 'response.output_item.done', output_index, item }));
      events.push({ type: 'response.completed', response: value });
    }
    else if (value.type === 'message') {
      events.push({ type: 'message_start', message: { ...value, content: [], stop_reason: null,
        usage: { input_tokens: value.usage.input_tokens, output_tokens: 0 } } });
      value.content.forEach((part, index) => {
        events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part.text } },
          { type: 'content_block_stop', index });
      });
      events.push({ type: 'message_delta', delta: { stop_reason: value.stop_reason, stop_sequence: null },
        usage: { output_tokens: value.usage.output_tokens } }, { type: 'message_stop' });
    } else return end(body);
    res.setHeader('content-type', 'text/event-stream');
    return end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  };
}
