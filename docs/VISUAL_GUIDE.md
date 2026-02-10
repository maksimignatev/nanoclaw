# NanoClaw Visual Guide

**Visual diagrams and flowcharts to understand NanoClaw architecture**

Last updated: 2026-02-10

---

## System Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│                          YOUR PHONE                                   │
│                        WhatsApp App                                   │
│                                                                       │
│   "@Andy what's the weather in London?"                             │
│                                                                       │
└──────────────────────────────┬────────────────────────────────────────┘
                               │
                               │ Internet (WhatsApp Cloud)
                               │
┌──────────────────────────────▼────────────────────────────────────────┐
│                                                                       │
│                      YOUR MAC/LINUX SERVER                           │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │              Node.js Main Process                           │   │
│  │              (src/index.ts)                                 │   │
│  │                                                              │   │
│  │  • Receives WhatsApp messages                               │   │
│  │  • Routes to registered groups                              │   │
│  │  • Manages container queue                                  │   │
│  │  • Sends responses back                                     │   │
│  │                                                              │   │
│  └────────────────────┬────────────────────────────────────────┘   │
│                       │                                             │
│                       │ Spawns containers                           │
│                       ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │            Apple Container / Docker                         │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐  │   │
│  │  │  Container: nanoclaw-agent:latest                   │  │   │
│  │  │                                                      │  │   │
│  │  │  • Runs Claude Agent SDK                            │  │   │
│  │  │  • Isolated Linux VM                                │  │   │
│  │  │  • Only sees mounted directories                    │  │   │
│  │  │  • Generates AI responses                           │  │   │
│  │  │                                                      │  │   │
│  │  └──────────────────────────────────────────────────────┘  │   │
│  │                                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Component Relationships

```
┌─────────────┐
│  WhatsApp   │ Incoming messages
│   Cloud     │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────────┐
│         Baileys Library                 │  Connects to WhatsApp Web
│    (WebSocket connection)               │
└──────┬──────────────────────────────────┘
       │ Events: messages.upsert
       ▼
┌─────────────────────────────────────────┐
│         Message Handler                 │  Store & filter messages
│         (src/index.ts)                  │
└──────┬──────────────────────────────────┘
       │
       ├─────────────────┐
       │                 │
       ▼                 ▼
┌────────────┐    ┌────────────┐
│   SQLite   │    │   Memory   │
│  Database  │    │   State    │
└─────┬──────┘    └──────┬─────┘
      │                  │
      └────────┬─────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      Message Polling Loop               │  Check for new messages
│      (Every 2 seconds)                  │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│         Trigger Check                   │  Match @Andy pattern
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│         GroupQueue                      │  Queue & concurrency
│      (src/group-queue.ts)               │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│      Container Runner                   │  Spawn & manage containers
│   (src/container-runner.ts)             │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│       Agent Container                   │  Claude AI processing
│  (container/agent-runner/)              │
└──────┬──────────────────────────────────┘
       │
       │ Streaming results
       ▼
┌─────────────────────────────────────────┐
│      Response Handler                   │  Parse & send to WhatsApp
│      (src/index.ts)                     │
└──────┬──────────────────────────────────┘
       │
       ▼
┌─────────────┐
│  WhatsApp   │ Outgoing messages
│   Cloud     │
└─────────────┘
```

---

## Message Flow (Detailed)

```
USER                WHATSAPP        NODE.JS         SQLITE        QUEUE         CONTAINER
  │                    │              │               │             │                │
  │  "@Andy hello"     │              │               │             │                │
  ├───────────────────>│              │               │             │                │
  │                    │              │               │             │                │
  │                    │ Event        │               │             │                │
  │                    ├─────────────>│               │             │                │
  │                    │              │               │             │                │
  │                    │              │ Store msg     │             │                │
  │                    │              ├──────────────>│             │                │
  │                    │              │               │             │                │
  │                    │              │ Poll (2sec)   │             │                │
  │                    │              │<──────────────┤             │                │
  │                    │              │ New msg!      │             │                │
  │                    │              │               │             │                │
  │                    │              │ Trigger?      │             │                │
  │                    │              │ (@Andy) ✓     │             │                │
  │                    │              │               │             │                │
  │                    │              │ Enqueue       │             │                │
  │                    │              ├───────────────┼────────────>│                │
  │                    │              │               │             │                │
  │                    │              │               │ Limit OK?   │                │
  │                    │              │               │ (5 max) ✓   │                │
  │                    │              │               │             │                │
  │                    │              │               │ Spawn       │                │
  │                    │              │<──────────────┼─────────────┤                │
  │                    │              │               │             │                │
  │                    │              │ Build mounts  │             │                │
  │                    │              │ Validate paths│             │                │
  │                    │              │               │             │                │
  │                    │              │ container run │             │                │
  │                    │              ├───────────────┼─────────────┼───────────────>│
  │                    │              │               │             │                │
  │                    │              │ Input JSON    │             │                │
  │                    │              ├───────────────┼─────────────┼───────────────>│
  │                    │              │               │             │                │
  │                    │              │               │             │    Process     │
  │                    │              │               │             │    with Claude │
  │                    │              │               │             │                │
  │                    │              │ Result        │             │                │
  │                    │              │<──────────────┼─────────────┼────────────────┤
  │                    │              │ (streaming)   │             │                │
  │                    │              │               │             │                │
  │                    │ Send msg     │               │             │                │
  │                    │<─────────────┤               │             │                │
  │                    │              │               │             │                │
  │  "Andy: Hello!"    │              │               │             │                │
  │<───────────────────┤              │               │             │                │
  │                    │              │               │             │                │
  │                    │              │               │             │    Idle timer  │
  │                    │              │               │             │    (30 min)    │
  │                    │              │               │             │                │
  │                    │              │               │             │    Exit        │
  │                    │              │               │             │<───────────────┤
  │                    │              │               │             │                │
```

---

## GroupQueue State Machine

```
                              ┌──────────────┐
                              │   Message    │
                              │   Arrives    │
                              └──────┬───────┘
                                     │
                                     ▼
                          ┌────────────────────┐
                          │  Is container      │
                          │  active for        │───Yes──> Set pendingMessages flag
                          │  this group?       │
                          └────────┬───────────┘
                                   │ No
                                   ▼
                          ┌────────────────────┐
                          │  At concurrency    │
                          │  limit?            │───Yes──> Add to waitingGroups
                          │  (5 containers)    │          Set pendingMessages flag
                          └────────┬───────────┘
                                   │ No
                                   ▼
                          ┌────────────────────┐
                          │  Spawn container   │
                          │  Set active=true   │
                          │  activeCount++     │
                          └────────┬───────────┘
                                   │
                                   ▼
                          ┌────────────────────┐
                          │  Process messages  │
                          └────────┬───────────┘
                                   │
                       ┌───────────┴───────────┐
                       │                       │
                    Success                 Error
                       │                       │
                       │                       ▼
                       │              ┌────────────────────┐
                       │              │  Increment retry   │
                       │              │  count             │
                       │              │  Schedule backoff  │
                       │              │  (5s, 10s, 20s...) │
                       │              └────────┬───────────┘
                       │                       │
                       └───────────┬───────────┘
                                   │
                                   ▼
                          ┌────────────────────┐
                          │  Set active=false  │
                          │  activeCount--     │
                          └────────┬───────────┘
                                   │
                                   ▼
                          ┌────────────────────┐
                          │  Drain pending     │
                          │  tasks/messages    │
                          └────────┬───────────┘
                                   │
                       ┌───────────┴───────────┐
                       │                       │
                   Has pending             No pending
                       │                       │
                       ▼                       ▼
              ┌────────────────┐      ┌────────────────┐
              │  Run next      │      │  Check waiting │
              │  task/message  │      │  groups        │
              └────────────────┘      └────────────────┘
```

---

## Container Isolation Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                          HOST FILESYSTEM                            │
│                                                                     │
│  /home/user/nanoclaw/                                              │
│  ├── src/              ← Main code (not mounted to non-main)      │
│  ├── groups/                                                       │
│  │   ├── main/        ← Main group workspace                      │
│  │   │   ├── CLAUDE.md                                            │
│  │   │   ├── logs/                                                │
│  │   │   └── ...                                                  │
│  │   │                                                             │
│  │   ├── global/      ← Shared read-only memory                   │
│  │   │   └── CLAUDE.md                                            │
│  │   │                                                             │
│  │   └── work-team/   ← Isolated group workspace                  │
│  │       ├── CLAUDE.md                                            │
│  │       ├── logs/                                                │
│  │       └── ...                                                  │
│  │                                                                 │
│  ├── data/                                                         │
│  │   ├── ipc/                                                     │
│  │   │   ├── main/     ← IPC for main group                      │
│  │   │   └── work-team/  ← IPC for work-team (isolated)          │
│  │   │                                                             │
│  │   └── sessions/                                                │
│  │       ├── main/.claude/                                        │
│  │       └── work-team/.claude/                                   │
│  │                                                                 │
│  └── store/                                                        │
│      └── messages.db                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                        ┌─────────┴─────────┐
                        │   Mount Rules     │
                        │   (Container)     │
                        └─────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │  Main Group     │  │  Work-Team      │  │  Family Chat    │
    │  Container      │  │  Container      │  │  Container      │
    │                 │  │                 │  │                 │
    │  /workspace/    │  │  /workspace/    │  │  /workspace/    │
    │  ├─ project/    │  │  ├─ group/      │  │  ├─ group/      │
    │  │  (FULL!)     │  │  │  (isolated!) │  │  │  (isolated!) │
    │  │              │  │  │              │  │  │              │
    │  ├─ group/      │  │  ├─ global/     │  │  ├─ global/     │
    │  │  (main/)     │  │  │  (readonly!) │  │  │  (readonly!) │
    │  │              │  │  │              │  │  │              │
    │  ├─ global/     │  │  ├─ ipc/        │  │  ├─ ipc/        │
    │  │  (readonly!) │  │  │  (isolated!) │  │  │  (isolated!) │
    │  │              │  │  │              │  │  │              │
    │  ├─ ipc/        │  │  └─ extra/      │  │  └─ extra/      │
    │  │  (isolated!) │  │     (validated!)│  │     (validated!)│
    │  │              │  │                 │  │                 │
    │  └─ extra/      │  │  ✗ Cannot see:  │  │  ✗ Cannot see:  │
    │     (validated!)│  │    • src/       │  │    • src/       │
    │                 │  │    • main/      │  │    • main/      │
    │  ✓ Can access:  │  │    • family/    │  │    • work-team/ │
    │    Everything!  │  │                 │  │                 │
    │                 │  │  ✓ Can only:    │  │  ✓ Can only:    │
    │                 │  │    • Read own   │  │    • Read own   │
    │                 │  │    • Read global│  │    • Read global│
    │                 │  │    • Use extra  │  │    • Use extra  │
    └─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Task Scheduler Flow

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                  SCHEDULER LOOP                              │
│                  (Every 60 seconds)                          │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Query SQLite   │
              │  for due tasks  │
              │                 │
              │  WHERE          │
              │  status=active  │
              │  AND next_run   │
              │  <= NOW()       │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Found 0 tasks? │──Yes──> Wait 60 seconds, loop
              └────────┬────────┘
                       │ No (found tasks)
                       ▼
              ┌─────────────────┐
              │  For each task: │
              │                 │
              │  1. Re-check    │
              │     status      │
              │                 │
              │  2. Enqueue to  │
              │     GroupQueue  │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  GroupQueue     │
              │  processes task │
              └────────┬────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
      Context Mode            Context Mode
       = group                 = isolated
           │                       │
           ▼                       ▼
    ┌──────────────┐        ┌──────────────┐
    │ Use group's  │        │ Create new   │
    │ session ID   │        │ session      │
    │ (stateful)   │        │ (stateless)  │
    └──────┬───────┘        └──────┬───────┘
           │                       │
           └───────────┬───────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Spawn container │
              │ with task       │
              │ prompt          │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Stream results  │
              │ to WhatsApp     │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ Log execution   │
              │ to              │
              │ task_run_logs   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │ Calculate next run  │
              │                     │
              │ • cron: Parse expr  │
              │ • interval: Add ms  │
              │ • once: Set null    │
              └────────┬────────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │ Update task in DB   │
              │                     │
              │ SET next_run=...    │
              │     last_run=...    │
              │     last_result=... │
              │     status=...      │
              └─────────────────────┘
```

---

## IPC Communication Patterns

### Pattern 1: Initial Query (Stdin/Stdout)

```
HOST                                    CONTAINER
  │                                         │
  │  Spawn container                        │
  ├────────────────────────────────────────>│
  │                                         │
  │  Write JSON to stdin:                   │
  │  {                                      │
  │    "prompt": "<messages>...</>",        │
  │    "sessionId": "abc123",               │
  │    "groupFolder": "main"                │
  │  }                                      │
  ├────────────────────────────────────────>│
  │                                         │
  │  Close stdin (send EOF)                 │
  ├────────────────────────────────────────>│
  │                                         │
  │                                         │  Read stdin until EOF
  │                                         │  Parse JSON
  │                                         │  Run query()
  │                                         │  Generate response
  │                                         │
  │  ---OUTPUT_START---                     │
  │  {"result": "Hello!"}                   │
  │  ---OUTPUT_END---                       │
  │<────────────────────────────────────────┤
  │                                         │
  │  Parse result                           │
  │  Send to WhatsApp                       │
  │                                         │
```

### Pattern 2: Follow-Up Messages (IPC Files)

```
HOST                                    CONTAINER
  │                                         │
  │                                         │  Waiting in IPC poll loop
  │                                         │  (checks every 500ms)
  │                                         │
  │  User sends new message                 │
  │  "actually check London"                │
  │                                         │
  │  Write IPC file:                        │
  │  /workspace/ipc/input/1234-abcd.json    │
  │  {                                      │
  │    "type": "message",                   │
  │    "text": "actually check London"      │
  │  }                                      │
  ├────────────────────────────────────────>│
  │                                         │
  │                                         │  Poll detects new file
  │                                         │  Read & parse JSON
  │                                         │  Delete file
  │                                         │  Push to MessageStream
  │                                         │  SDK receives message
  │                                         │  Adjusts response
  │                                         │
  │  ---OUTPUT_START---                     │
  │  {"result": "Weather in London: 15°C"}  │
  │  ---OUTPUT_END---                       │
  │<────────────────────────────────────────┤
  │                                         │
  │  Send to WhatsApp                       │
  │                                         │
```

### Pattern 3: Close Signal (Sentinel File)

```
HOST                                    CONTAINER
  │                                         │
  │                                         │  Idle timeout expires
  │                                         │  (30 minutes no output)
  │                                         │
  │  Write sentinel:                        │
  │  /workspace/ipc/input/_close            │
  │  (empty file)                           │
  ├────────────────────────────────────────>│
  │                                         │
  │                                         │  Poll detects _close
  │                                         │  Call messageStream.end()
  │                                         │  SDK finishes gracefully
  │                                         │  Exit process
  │                                         │
  │  Container exited (exit code 0)         │
  │<────────────────────────────────────────┤
  │                                         │
  │  --rm flag auto-cleans container        │
  │                                         │
```

### Pattern 4: MCP Tool Call (Container → Host)

```
CONTAINER                               HOST
  │                                         │
  │  Agent calls MCP tool:                  │
  │  nanoclaw_send_message({                │
  │    chatJid: "123@s.whatsapp.net",       │
  │    text: "Hello from agent"             │
  │  })                                     │
  │                                         │
  │  Write to IPC:                          │
  │  /workspace/ipc/messages/1234-efgh.json │
  │  {                                      │
  │    "toolCallId": "call_123",            │
  │    "type": "send_message",              │
  │    "chatJid": "123@s.whatsapp.net",     │
  │    "text": "Hello from agent"           │
  │  }                                      │
  ├────────────────────────────────────────>│
  │                                         │
  │                                         │  IPC watcher detects file
  │                                         │  Read & parse JSON
  │                                         │  Call sock.sendMessage()
  │                                         │  Write response:
  │                                         │
  │  /workspace/ipc/messages/               │
  │    1234-efgh-response.json              │
  │  {                                      │
  │    "toolCallId": "call_123",            │
  │    "success": true                      │
  │  }                                      │
  │<────────────────────────────────────────┤
  │                                         │
  │  MCP server reads response              │
  │  Returns to SDK                         │
  │  Agent continues                        │
  │                                         │
```

---

## Memory Hierarchy

```
                    ┌─────────────────────────────┐
                    │   Claude Agent SDK          │
                    │   Memory System             │
                    └────────────┬────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │               │               │
                 ▼               ▼               ▼
        ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
        │  Session    │  │  CLAUDE.md  │  │  Files in   │
        │  Transcript │  │  (User      │  │  Workspace  │
        │  (SDK auto) │  │  Memory)    │  │  (Explicit) │
        └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
               │                │                │
               │                │                │
    Conversation history  User preferences   Working files
    Turns (user/agent)    Long-term facts    Created by agent
    Tool calls            Reminders          or user
    Results               Context            
                                                
    Example:              Example:           Example:
    • "What's weather?"   • "Favorite        • sales-report.md
    • "15°C in London"    •  color: blue"    • data.json
    • "Thanks!"           • "Work email:     • screenshot.png
    • "You're welcome!"   •  user@work.com"  
                          • "Prefers brief   
                          •  responses"      
```

### Main Group Memory

```
groups/main/
├── CLAUDE.md                    ← Agent auto-manages
│   • Long-term user facts
│   • Preferences
│   • Important context
│
├── conversations/               ← Full archives
│   ├── 2026-02-10-session-abc.md
│   ├── 2026-02-09-session-xyz.md
│   └── ...
│
└── [working files]              ← Created by agent
    ├── notes.md
    ├── todo.txt
    └── ...
```

### Group Memory (Non-Main)

```
groups/work-team/
├── CLAUDE.md                    ← Auto-managed, isolated
│   • Facts about this group
│   • Team preferences
│   • Project context
│
└── [working files]
    ├── project-notes.md
    └── ...

groups/global/                   ← Shared, read-only
└── CLAUDE.md
    • Facts visible to all groups
    • Only writable from main
```

---

## Security Boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                      TRUSTED ZONE (Host)                         │
│                                                                  │
│  • Main Node.js process (src/)                                  │
│  • SQLite database (store/messages.db)                          │
│  • WhatsApp auth (store/auth_info_baileys/)                     │
│  • Mount allowlist (~/.config/nanoclaw/mount-allowlist.json)    │
│                                                                  │
│  Capabilities:                                                   │
│  ✓ Full filesystem access                                       │
│  ✓ Network access                                               │
│  ✓ Spawn containers                                             │
│  ✓ Send WhatsApp messages                                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │ Controlled boundary
                              │ (mount validation)
                              │
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│                   UNTRUSTED ZONE (Containers)                    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Main Group Container                                      │ │
│  │                                                            │ │
│  │  Capabilities:                                             │ │
│  │  ✓ Full project access (mounted)                          │ │
│  │  ✓ Can modify code (with permission)                      │ │
│  │  ✓ Can register new groups                                │ │
│  │  ✓ Can manage all tasks                                   │ │
│  │  ✓ Read/write global memory                               │ │
│  │                                                            │ │
│  │  Security:                                                 │ │
│  │  ✗ Cannot modify mount allowlist (not mounted)            │ │
│  │  ✗ Cannot modify WhatsApp auth (not mounted)              │ │
│  │  ✗ Cannot escape container                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Other Group Containers                                    │ │
│  │                                                            │ │
│  │  Capabilities:                                             │ │
│  │  ✓ Own workspace only                                     │ │
│  │  ✓ Read global memory (read-only)                         │ │
│  │  ✓ Additional mounts (validated)                          │ │
│  │                                                            │ │
│  │  Security:                                                 │ │
│  │  ✗ Cannot see project root                                │ │
│  │  ✗ Cannot see other groups                                │ │
│  │  ✗ Cannot register groups                                 │ │
│  │  ✗ Cannot see other groups' tasks                         │ │
│  │  ✗ Cannot write to global memory                          │ │
│  │  ✗ Read-write forced to read-only (configurable)          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Concurrency Model

```
┌───────────────────────────────────────────────────────────────────┐
│                      GLOBAL CONCURRENCY LIMIT                     │
│                         (MAX: 5 containers)                       │
└───────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ Container 1  │ │ Container 2  │ │ Container 3  │
        │              │ │              │ │              │
        │ Group: main  │ │ Group: work  │ │ Group: fam   │
        │ Status: RUN  │ │ Status: RUN  │ │ Status: RUN  │
        └──────────────┘ └──────────────┘ └──────────────┘

        Slots used: 3/5
        Available: 2 slots

        ┌──────────────────────────────────────────┐
        │     WAITING QUEUE (FIFO)                 │
        │                                          │
        │  1. Group: hobby (1 message pending)     │
        │  2. Group: work (2 tasks pending)        │
        │  3. Group: family (1 message pending)    │
        └──────────────────────────────────────────┘

When Container 1 completes:
  1. activeCount decreases (2/5)
  2. Check waiting queue
  3. Dequeue "hobby"
  4. Spawn container for hobby
  5. activeCount increases (3/5)
```

### Per-Group Queue

```
Group "work-team" State:
┌─────────────────────────────────┐
│ active: true                    │  Container running
│ process: ChildProcess {...}     │  
│ containerName: nanoclaw-work... │
│ groupFolder: "work-team"        │
│                                 │
│ pendingMessages: true           │  Messages arrived while processing
│ pendingTasks: [                 │  Tasks queued
│   { id: "task-1", ... },        │
│   { id: "task-2", ... }         │
│ ]                               │
│                                 │
│ retryCount: 0                   │  No errors yet
└─────────────────────────────────┘

Processing order when container completes:
  1. Tasks (FIFO) - run first
  2. Messages - run after tasks
  3. Drain waiting groups - if no pending work
```

---

## Deployment Patterns

### Development

```
┌────────────────────────────────────┐
│  Terminal 1                        │
│                                    │
│  $ npm run dev                     │
│                                    │
│  • Hot reload with tsx             │
│  • Logs to console                 │
│  • Container spawning enabled      │
│                                    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  Terminal 2 (Optional)             │
│                                    │
│  $ tail -f groups/main/logs/*.log  │
│                                    │
│  • Watch container logs            │
│                                    │
└────────────────────────────────────┘
```

### Production (macOS)

```
┌────────────────────────────────────────────────────────┐
│  launchd Service                                       │
│                                                        │
│  ~/Library/LaunchAgents/com.nanoclaw.plist             │
│                                                        │
│  <plist>                                               │
│    <key>Label</key>                                    │
│    <string>com.nanoclaw</string>                       │
│                                                        │
│    <key>ProgramArguments</key>                         │
│    <array>                                             │
│      <string>node</string>                             │
│      <string>dist/index.js</string>                    │
│    </array>                                            │
│                                                        │
│    <key>RunAtLoad</key>                                │
│    <true/>                                             │
│                                                        │
│    <key>KeepAlive</key>                                │
│    <true/>                                             │
│  </plist>                                              │
│                                                        │
│  Commands:                                             │
│  • launchctl load ~/Library/LaunchAgents/...          │
│  • launchctl unload ~/Library/LaunchAgents/...        │
│  • launchctl list | grep nanoclaw                     │
│                                                        │
│  Features:                                             │
│  ✓ Starts on boot                                     │
│  ✓ Auto-restart on crash                              │
│  ✓ Logging via system log                             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Production (Linux with systemd)

```
┌────────────────────────────────────────────────────────┐
│  systemd Service                                       │
│                                                        │
│  /etc/systemd/system/nanoclaw.service                  │
│                                                        │
│  [Unit]                                                │
│  Description=NanoClaw Personal Assistant               │
│  After=network.target                                  │
│                                                        │
│  [Service]                                             │
│  Type=simple                                           │
│  User=youruser                                         │
│  WorkingDirectory=/home/youruser/nanoclaw              │
│  ExecStart=/usr/bin/node dist/index.js                 │
│  Restart=always                                        │
│  RestartSec=10                                         │
│                                                        │
│  [Install]                                             │
│  WantedBy=multi-user.target                            │
│                                                        │
│  Commands:                                             │
│  • sudo systemctl enable nanoclaw                      │
│  • sudo systemctl start nanoclaw                       │
│  • sudo systemctl status nanoclaw                      │
│  • journalctl -u nanoclaw -f                          │
│                                                        │
│  Features:                                             │
│  ✓ Starts on boot                                     │
│  ✓ Auto-restart on crash                              │
│  ✓ Integrated logging                                 │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Common Scenarios

### Scenario 1: First-Time Setup

```
1. Clone repository
   $ git clone https://github.com/gavrielc/nanoclaw.git
   $ cd nanoclaw

2. Open in Claude Code
   $ claude

3. Run setup skill
   > /setup

4. Setup walks through:
   ├─ Install dependencies (npm install)
   ├─ Build container image (./container/build.sh)
   ├─ Create .env file
   ├─ Get Claude auth (OAuth or API key)
   ├─ WhatsApp QR code authentication
   ├─ Register main group (your self-chat)
   └─ Start background service (launchd/systemd)

5. Test
   Send "@Andy hello" to yourself on WhatsApp
   Receive response from Claude
```

### Scenario 2: Adding New Group

```
1. User sends (in main/self-chat):
   "@Andy register the 'Work Team' group"

2. Main container processes:
   ├─ Call nanoclaw_list_groups MCP tool
   ├─ Show available groups
   └─ User selects "Work Team" from list

3. Main container calls:
   nanoclaw_register_group({
     jid: "12345@g.us",
     name: "Work Team",
     folder: "work-team"
   })

4. Host (index.ts):
   ├─ Create groups/work-team/
   ├─ Create groups/work-team/logs/
   ├─ Insert into registered_groups table
   └─ Add to memory cache

5. Next message in Work Team:
   "@Andy what's our project status?"
   ✓ Triggers isolated container for work-team
   ✓ Has own CLAUDE.md memory
   ✓ Cannot see main or other groups
```

### Scenario 3: Scheduling Task

```
1. User sends (in any registered group):
   "@Andy schedule: send sales report every Monday at 9am"

2. Agent parses request:
   ├─ Prompt: "send sales report"
   ├─ Schedule: "every Monday at 9am" → cron: "0 9 * * 1"
   └─ Context: group (use group's session)

3. Agent calls:
   nanoclaw_schedule_task({
     prompt: "Generate and send sales report",
     schedule: "0 9 * * 1",
     contextMode: "group"
   })

4. Host creates task:
   INSERT INTO scheduled_tasks
   (id, group_folder, chat_jid, prompt, schedule_type,
    schedule_value, context_mode, next_run, status)
   VALUES
   (uuid(), 'work-team', '12345@g.us',
    'Generate and send sales report',
    'cron', '0 9 * * 1', 'group',
    '2026-02-17T09:00:00Z', 'active')

5. Next Monday at 9am:
   ├─ Scheduler finds task
   ├─ Enqueues to GroupQueue
   ├─ Spawns container with group's session
   ├─ Generates report
   └─ Sends to work-team WhatsApp group
```

### Scenario 4: Multi-Turn Conversation

```
Time: 10:00:00
User: "@Andy what's the weather?"
  ├─ Container spawns
  ├─ Starts processing
  └─ Idle timer starts (30 min)

Time: 10:00:02 (while processing)
User: "actually check London"
  ├─ index.ts detects active container
  ├─ Writes to /workspace/ipc/input/...json
  ├─ Container's poll loop picks it up
  ├─ Pushes to MessageStream
  └─ SDK receives as follow-up

Time: 10:00:05
Agent: "Weather in London: 15°C, partly cloudy"
  ├─ Result sent to WhatsApp
  └─ Idle timer resets (30 min from now)

Time: 10:00:10
User: "what about tomorrow?"
  ├─ Pipes into same container
  └─ Continues conversation

Time: 10:30:10 (no more messages)
  ├─ Idle timer expires
  ├─ Writes _close sentinel
  ├─ Container exits gracefully
  └─ Next message spawns new container
```

---

This visual guide provides diagrams and flowcharts to complement the detailed breakdown in CODEBASE_BREAKDOWN.md. Use both documents together for a complete understanding of NanoClaw's architecture.
