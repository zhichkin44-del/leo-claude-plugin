---
name: doctor
description: "Check that Leo can work on this machine: Node, claude in PATH, hooks, rights, config."
disable-model-invocation: true
---

Run this command with the Bash tool and show the user its output. For every line that starts with [FIX ] explain in one sentence what to do. Add --ping to the command only if the user asks for a real test call (it costs a fraction of a cent).

```
node "${CLAUDE_PLUGIN_ROOT}/bin/leo.mjs" doctor
```


