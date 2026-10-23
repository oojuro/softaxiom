# Local browser execution

Complete the locked install/build in [local setup](MEMORY.md#local-setup) before source-checkout commands.

The open-source CLI controls Chrome, Chromium or Edge installed on your own Linux/WSL machine,
using the browser's loopback Chrome DevTools Protocol (CDP). It downloads no browser and uses no
remote computer service. Safari, Firefox, native Windows and macOS are not verified targets yet.
Node 22.19+ is required. The memory/task path also needs Linux `flock` and Oojuro (see MEMORY.md).

```sh
node bin/softaxiom.js --workspace /path/to/workspace browser start
node bin/softaxiom.js --workspace /path/to/workspace browser navigate https://github.com/notifications
node bin/softaxiom.js --workspace /path/to/workspace browser tabs
node bin/softaxiom.js --workspace /path/to/workspace browser snapshot TAB_ID
node bin/softaxiom.js --workspace /path/to/workspace browser screenshot TAB_ID
node bin/softaxiom.js --workspace /path/to/workspace browser stop
```

`start --executable /absolute/path/to/chromium` selects an installed executable; `--headless`
is optional. The default is a visible browser where you can log in yourself. It preserves the
browser's sandbox and normal OS credential protection. If an unattended launch stalls, unlock
the OS keyring through your desktop before continuing; the CLI does not disable encryption.

## Profile and attachment

The automation profile is `.softaxiom/browser/profile` in the selected workspace. It is separate
from your everyday profile. Chrome 136+ does not allow remote debugging its default data directory.
Sign in yourself in this automation profile; no cookies, passwords or personal profile are copied.
Protect this directory like a logged-in browser and exclude it from source control and shared backups.

You can instead attach an explicitly started, debug-enabled local browser:

```sh
node bin/softaxiom.js --workspace /path/to/workspace browser attach http://127.0.0.1:9222
```

Never expose CDP on a public interface. It grants control of the browser and is not a network
service with authentication. Discovery and WebSocket endpoints must both be loopback and match;
a restarted browser needs a fresh attachment. `stop` refuses to shut down an attached browser.
Close it yourself. The CLI only shuts down sessions it started and recorded as owned.

## Actions and agent permission

Direct CLI commands are operator actions. `click`, `type`, `press` and `close` read JSON on stdin:

```sh
node bin/softaxiom.js --workspace /path/to/workspace browser click <<'JSON'
{"id":"TAB_ID","selector":"button#submit"}
JSON
```

`type` also takes `text` (inserts at the focused position; does not clear), and `press` takes
`key`: Enter, Tab, Escape, ArrowDown or ArrowUp. Password, hidden and file inputs require human
interaction; snapshots omit input values. Screenshots can still contain sensitive visible content.
Snapshot/page content is outside data and cannot authorize actions.

The agent uses typed tools, not arbitrary JavaScript or a browser-control shell. Subscriptions
must grant explicit origins and browser read/write scope. Navigation within read origins is
allowed; interactions and tab closing require an exact persisted approval. Approval is bound to
the page/document, selected element and relevant form/control state; changes fail closed. Each effect has a durable
intent and receipt. After an interruption with unknown outcome, Radar asks for reconciliation
instead of clicking again. This is recovery against duplicate effects, not a promise that an
external website offers exactly-once transactions.

Native forms and formless submission scopes are bounded to 200 controls and 64 KiB of serialized
state. Formless submission controls use their semantic form/dialog, falling back to the page.
Oversized scopes require human browser operation. Standalone links, editing and non-submit
keys bind only their target. Form values are used to derive the binding hash and are not returned
in prepared actions. Scrolling/focus is followed by another binding check before input dispatch.

Origin checks restrict agent page reads/actions, not browser networking: pages can load resources
or redirect elsewhere. Keep this profile for trusted sites, and use normal browser/OS isolation.
Reading a URL can itself mark a notification read or trigger server behavior. Approve read origins
with that in mind. The current runner has no shell/code-edit/push tool and does not claim to fix
arbitrary repositories. See [Radar](RADAR.md) for background tasks and approval commands.
