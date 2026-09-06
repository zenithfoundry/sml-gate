# Context Distillation and Elision

Context distillation and elision are how `small-language-model-gate` prevents your AI editor from wasting money and time re-reading old tool outputs.

When an AI works on a task, it uses tools (like `read_file` or `run_command`). The output of these tools can be huge. Without elision, the AI sends the entire history of every tool output back to the cloud model on every single turn.

> [!NOTE]
> Turn 4:  ...[tool: read_file foo.ts = 20k tokens][assistant edit][assistant: next...]  <- redundant
>
> We keep paying to re-send those 20k tokens every turn even though the model already acted on them.

Elision solves this by removing old tool outputs from the history before sending the prompt to the cloud model. The model re-reads exactly what it needs for the current turn, and sees a short marker where old data used to be.

## How the code actually decides what to drop

The rule is purely structural — a message is dropped if it is NOT the current turn AND its role is `tool`.

The code does NOT track whether the agent read or used it; "already used" is the assumption behind the rule, not something the code verifies.

Here is the actual filter:
```javascript
const shouldDrop = (message.role === 'tool' && !isCurrentTurn);
```

Because this is a blind guess, the visible marker + `expand_elision` are what make it safe. If the model needs the old data, it sees the marker and uses the tool to get it back.

## The Safety Model

Why is it safe to blindly drop data? Because AI models are designed to ask for help when they know they are missing something.

> [!IMPORTANT]
> A model doesn't hallucinate content it can see is missing — it fills gaps it doesn't know
> exist. A visible gap makes it ask for the missing part instead of guessing.

By leaving a visible marker, we tell the model exactly what was removed. It won't guess what was in the file; it will just ask for it again if it needs it.

## Managing the elision database

When we drop a tool output, we save the original text in a local SQLite database (the elision database). We store it so the model can retrieve it later if it calls the `expand_elision` tool.

Because tool outputs can be large, this database grows over time. We manage its size automatically:
- **Size Cap:** The database is capped at 500 MB. If it grows larger, the oldest unused entries are automatically deleted.
- **Retention:** Entries are kept for 180 days (6 months). Older entries are automatically deleted when you use the system.

You can also manage the database manually using these commands:
- `npm run elision:stats` - Shows how much space the database is using.
- `npm run elision:clean` - Opens an interactive menu to clean up old data.
- `npm run elision:clean:dry` - Shows what would be deleted if you removed data older than 180 days, without actually deleting anything.
- `npm run elision:clean:old` - Deletes data older than 180 days.
- `npm run elision:clean:all` - Deletes all elision data.

**Guarantee:** Cleanup only ever removes elision data. It never touches cost/analytics data in the ledger.
