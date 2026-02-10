# NanoClaw Codebase Breakdown

**Complete technical breakdown of the NanoClaw architecture**

Last updated: 2026-02-10

---

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [File Structure](#file-structure)
6. [Key Concepts](#key-concepts)
7. [Security Model](#security-model)
8. [Execution Flow](#execution-flow)
9. [Database Schema](#database-schema)
10. [IPC Mechanism](#ipc-mechanism)
11. [Skills System](#skills-system)
12. [Configuration](#configuration)

---

## High-Level Overview

NanoClaw is a **personal AI assistant** that:
- Connects to WhatsApp as your primary I/O channel
- Routes messages to Claude Agent SDK running in isolated Linux containers
- Maintains per-group memory and isolated execution environments
- Supports scheduled tasks that can message you back
- Provides web access and browser automation capabilities

### Philosophy

- **Small enough to understand**: ~1,500 lines of core code
- **Secure by isolation**: OS-level container isolation, not permission checks
- **Built for one user**: Customization via code changes, not configuration sprawl
- **AI-native**: Claude Code handles setup, debugging, and customization

### Technical Stack

```
Node.js (v20+)
├── WhatsApp (baileys library)
├── SQLite (better-sqlite3)
├── Container Runtime (Apple Container or Docker)
└── Claude Agent SDK (running in containers)
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              WhatsApp Cloud                              │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ Messages
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         src/index.ts (Main Process)                      │
│                                                                          │
│  ┌──────────────┐   ┌─────────────┐   ┌──────────────┐                │
│  │  WhatsApp    │──▶│   Router    │──▶│  GroupQueue  │                │
│  │  Connection  │   │  (Trigger)  │   │ (Concurrency)│                │
│  └──────────────┘   └─────────────┘   └──────┬───────┘                │
│                                                │                         │
│  ┌──────────────────────────────────────────┐ │                         │
│  │      SQLite Database (store/messages.db)  │ │                         │
│  │  • Messages  • Groups  • Tasks  • State  │ │                         │
│  └──────────────────────────────────────────┘ │                         │
│                                                │                         │
│  ┌──────────────────────────────────────────┐ │                         │
│  │    Task Scheduler (task-scheduler.ts)    │─┘                         │
│  │    Polls SQLite for due tasks            │                           │
│  └──────────────────────────────────────────┘                           │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Spawns containers
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                Container Runtime (Apple Container / Docker)             │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │              Container: nanoclaw-agent:latest                    │  │
│  │                                                                  │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │         agent-runner (container/agent-runner/src/)        │ │  │
│  │  │                                                            │ │  │
│  │  │  • Reads JSON input from stdin                           │ │  │
│  │  │  • Runs Claude Agent SDK (query() function)              │ │  │
│  │  │  • Polls IPC directory for follow-up messages            │ │  │
│  │  │  • Streams results back via stdout markers               │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                                                                  │  │
│  │  Mounts (per group):                                             │  │
│  │  ├── /workspace/group (group's folder - read/write)             │  │
│  │  ├── /workspace/global (global memory - read-only)              │  │
│  │  ├── /workspace/ipc (IPC directory - read/write)                │  │
│  │  ├── /workspace/extra/* (additional validated mounts)           │  │
│  │  └── /home/node/.claude (Claude sessions - read/write)          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Main Process (`src/index.ts`)

**Purpose**: Single Node.js process that orchestrates everything

**Responsibilities**:
- Connects to WhatsApp using Baileys library
- Listens for incoming messages
- Routes messages to appropriate groups based on trigger pattern
- Manages message queue and container lifecycle
- Sends responses back to WhatsApp
- Handles WhatsApp reconnections gracefully

**Key Functions**:
```typescript
// Initialize WhatsApp connection
async function connectToWhatsApp() {
  // Uses multi-file auth state for persistence
  // Generates QR code on first run
  // Automatically reconnects on disconnect
}

// Main message processing loop
async function startMessageLoop() {
  // Polls SQLite every 2 seconds for new messages
  // Forwards to GroupQueue for processing
}

// Process messages for a specific group
async function processGroupMessages(chatJid: string) {
  // Fetches missed messages since last interaction
  // Checks for trigger pattern (e.g., @Andy)
  // Spawns container and streams responses
}
```

**State Management**:
- `lastTimestamp`: Tracks last message processed globally
- `lastAgentTimestamp`: Tracks last interaction per group
- `registeredGroups`: Map of JID → group config
- `sessions`: Map of group → Claude session ID
- `lidToPhoneMap`: Translates WhatsApp LID format to phone numbers

---

### 2. Database Layer (`src/db.ts`)

**Purpose**: SQLite wrapper for all persistent data

**Tables**:

```sql
-- Chat metadata (all conversations, minimal data)
CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
);

-- Message content (only registered groups)
CREATE TABLE messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  PRIMARY KEY (id, chat_jid)
);

-- Registered groups configuration
CREATE TABLE registered_groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  trigger_pattern TEXT NOT NULL,
  added_at TEXT NOT NULL,
  container_config TEXT,        -- JSON: { additionalMounts, timeout }
  requires_trigger INTEGER       -- 1 = requires @Andy, 0 = responds to all
);

-- Scheduled tasks
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL,  -- 'cron', 'interval', 'once'
  schedule_value TEXT NOT NULL, -- cron expr or milliseconds
  context_mode TEXT,             -- 'group' or 'isolated'
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT DEFAULT 'active'  -- 'active', 'paused', 'completed'
);

-- Task execution logs
CREATE TABLE task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,         -- 'success' or 'error'
  result TEXT,
  error TEXT
);

-- Claude session state
CREATE TABLE sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

-- Router state (last timestamps, etc.)
CREATE TABLE router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Key Operations**:
```typescript
// Store message for registered group
storeMessage(msg: WebMessageInfo, chatJid: string, isFromMe: boolean)

// Get new messages since timestamp
getNewMessages(jids: string[], lastTimestamp: string, botPrefix: string)

// Register a group
setRegisteredGroup(jid: string, group: RegisteredGroup)

// Task management
createTask(task: ScheduledTask)
getDueTasks(): ScheduledTask[]
updateTaskAfterRun(id: string, nextRun: string | null, result: string)
```

**Migration System**:
- Automatically migrates from legacy JSON files on startup
- Renames old files to `.migrated` after successful migration
- Handles schema evolution with `ALTER TABLE` migrations

---

### 3. Group Queue (`src/group-queue.ts`)

**Purpose**: Manages concurrent container execution with global limit

**Features**:
- **Global concurrency limit**: Max 5 containers running simultaneously (configurable)
- **Per-group queuing**: Each group has its own queue
- **Priority system**: Tasks run before messages when both pending
- **Retry with exponential backoff**: Max 5 retries with increasing delays
- **Graceful shutdown**: Detaches containers on process restart (no kill)

**State Machine**:
```typescript
interface GroupState {
  active: boolean;           // Is container running?
  pendingMessages: boolean;  // Messages queued?
  pendingTasks: QueuedTask[]; // Tasks queued?
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
}
```

**Flow**:
```
Message arrives → enqueueMessageCheck()
                      ↓
            Is container active?
             ├─ Yes → Set pendingMessages flag
             └─ No  → Check global limit
                      ├─ At limit → Add to waitingGroups
                      └─ Available → runForGroup()
                                       ↓
                              processMessagesFn()
                                       ↓
                              drainGroup() → Process pending tasks/messages
```

---

### 4. Container Runner (`src/container-runner.ts`)

**Purpose**: Spawns and manages isolated agent containers

**Container Lifecycle**:

```
1. Build volume mounts
   ├─ Group workspace (/workspace/group)
   ├─ Global memory (/workspace/global) - read-only for non-main
   ├─ IPC directory (/workspace/ipc)
   ├─ Claude sessions (/home/node/.claude)
   ├─ Environment file (/workspace/env-dir) - filtered .env vars
   └─ Additional mounts (validated against allowlist)

2. Spawn container
   `container run -i --rm --name nanoclaw-{group}-{timestamp} ...`

3. Send input JSON to stdin
   {
     prompt: "<messages>...</messages>",
     sessionId: "abc123",
     groupFolder: "main",
     chatJid: "1234567890@s.whatsapp.net",
     isMain: true
   }

4. Parse streaming output
   For each OUTPUT_START_MARKER ... OUTPUT_END_MARKER pair:
   - Extract ContainerOutput JSON
   - Call onOutput callback with result
   - Reset idle timeout
   - Send result to WhatsApp

5. Handle completion/timeout
   - Write container logs to groups/{folder}/logs/
   - Clean up (--rm flag auto-removes container)
   - Return final status
```

**Timeout Handling**:
- **Hard timeout**: 30 minutes default (configurable per group)
- **Idle timeout**: 30 minutes of no output (separate from hard timeout)
- Resets on each streamed result (keeps container alive for rapid messages)
- Graceful stop via `container stop`, fallback to SIGKILL

**Mount Security**:
- Main group gets entire project root mounted
- Other groups only get their isolated folder
- Additional mounts validated against external allowlist
- Non-main groups forced to read-only (configurable)

---

### 5. Task Scheduler (`src/task-scheduler.ts`)

**Purpose**: Runs scheduled tasks on cron/interval/once schedules

**Polling Loop**:
```typescript
setInterval(() => {
  const dueTasks = getDueTasks(); // WHERE next_run <= NOW AND status = 'active'
  
  for (const task of dueTasks) {
    queue.enqueueTask(task.chat_jid, task.id, () => runTask(task));
  }
}, 60_000); // Check every 60 seconds
```

**Task Types**:
- **cron**: Runs on cron schedule (e.g., `0 9 * * 1-5` = weekdays at 9am)
- **interval**: Runs every N milliseconds
- **once**: Runs once at specified time, then marks as 'completed'

**Context Modes**:
- **isolated**: Creates new Claude session for each run (stateless)
- **group**: Uses group's current session (stateful, maintains conversation)

**Execution**:
```typescript
async function runTask(task: ScheduledTask) {
  // 1. Find the group config
  // 2. Write tasks snapshot to IPC
  // 3. Spawn container with task prompt
  // 4. Stream results back to WhatsApp
  // 5. Log execution to task_run_logs
  // 6. Calculate next run time
  // 7. Update task in database
}
```

**Idle Timeout**:
- Starts after each result is sent
- Writes `_close` sentinel to IPC after 30 minutes of silence
- Container gracefully exits instead of hanging forever

---

### 6. Agent Runner (`container/agent-runner/src/index.ts`)

**Purpose**: Runs inside container, bridges IPC with Claude Agent SDK

**Input Protocol**:
- **Stdin**: Full `ContainerInput` JSON (read until EOF)
- **IPC Files**: Follow-up messages in `/workspace/ipc/input/*.json`
- **Close Sentinel**: `/workspace/ipc/input/_close` signals end

**Output Protocol**:
```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"Hello!","newSessionId":"abc123"}
---NANOCLAW_OUTPUT_END---
```

**Main Loop**:
```typescript
async function main() {
  // 1. Read initial prompt from stdin
  const input = await readStdin();
  
  // 2. Create streaming message queue
  const messageStream = new MessageStream();
  
  // 3. Start IPC polling in background
  pollIpcForMessages(messageStream);
  
  // 4. Run Claude Agent SDK
  const result = await query({
    prompt: input.prompt,
    sessionId: input.sessionId,
    workingDir: '/workspace/group',
    stream: async function* () {
      yield* messageStream; // Stream follow-up messages
    }
  });
  
  // 5. Output results (may be multiple for agent teams)
  for await (const output of result) {
    writeOutput({
      status: 'success',
      result: output.text,
      newSessionId: output.sessionId
    });
  }
}
```

**IPC Polling**:
```typescript
setInterval(() => {
  const files = fs.readdirSync('/workspace/ipc/input');
  
  for (const file of files) {
    if (file === '_close') {
      messageStream.end();
      return;
    }
    
    const message = JSON.parse(fs.readFileSync(file));
    messageStream.push(message.text);
    fs.unlinkSync(file); // Consume message
  }
}, 500); // Poll every 500ms
```

**Conversation Archiving**:
- Before compaction (cleanup), archives full transcript to `conversations/`
- Keeps compact session for Claude, full history for user
- Uses pre-compact hook from Claude Agent SDK

---

### 7. Mount Security (`src/mount-security.ts`)

**Purpose**: Validates additional mounts against tamper-proof allowlist

**Security Model**:

```
Allowlist location: ~/.config/nanoclaw/mount-allowlist.json
                    (OUTSIDE project root, never mounted in containers)

{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    }
  ],
  "blockedPatterns": [".ssh", ".gnupg", "credentials"],
  "nonMainReadOnly": true
}
```

**Validation Steps**:
1. **Expand path**: `~/projects` → `/Users/user/projects`
2. **Resolve symlinks**: Get real path on filesystem
3. **Check existence**: Path must exist
4. **Check blocked patterns**: Reject if matches `.ssh`, `.env`, etc.
5. **Check allowed roots**: Must be under an allowed root directory
6. **Determine readonly**: Apply root policy + non-main policy
7. **Resolve container path**: Prefix with `/workspace/extra/`

**Default Blocked Patterns**:
```typescript
['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker',
 'credentials', '.env', '.netrc', '.npmrc', 'id_rsa',
 'private_key', '.secret']
```

**Example**:
```typescript
// Group config requests:
{
  additionalMounts: [
    { hostPath: "~/projects/myapp", readonly: false }
  ]
}

// Validation result:
{
  allowed: true,
  realHostPath: "/Users/user/projects/myapp",
  containerPath: "/workspace/extra/myapp",
  effectiveReadonly: false  // Main group + allowed root → read-write OK
}
```

---

## Data Flow

### 1. Message Flow (WhatsApp → Agent → Response)

```
1. WhatsApp Cloud sends message
   ↓
2. Baileys library emits 'messages.upsert' event
   ↓
3. index.ts receives message
   ├─ Store chat metadata (all chats)
   └─ Store full message (registered groups only)
   ↓
4. Message polling loop detects new message
   ├─ Check if group is registered
   ├─ Check for trigger pattern (@Andy)
   └─ Enqueue to GroupQueue
   ↓
5. GroupQueue checks concurrency
   ├─ If at limit → Queue message
   └─ If available → Spawn container
   ↓
6. Container Runner builds mounts
   ├─ Validate additional mounts
   ├─ Sync skills from container/skills/
   └─ Create IPC directories
   ↓
7. Spawn container process
   `container run -i --rm nanoclaw-agent:latest`
   ↓
8. Write input JSON to stdin
   {
     prompt: "<messages>...</messages>",
     sessionId: "previous-session-id",
     groupFolder: "main",
     ...
   }
   ↓
9. Container reads stdin, runs Claude Agent SDK
   ↓
10. Claude generates response, outputs to stdout
    ---NANOCLAW_OUTPUT_START---
    {"status":"success","result":"Hello!"}
    ---NANOCLAW_OUTPUT_END---
   ↓
11. Container Runner parses output markers
    ├─ Strip <internal>...</internal> tags
    ├─ Call onOutput callback
    └─ Reset idle timeout
   ↓
12. Send to WhatsApp
    sock.sendMessage(jid, { text: "Andy: Hello!" })
   ↓
13. Container polls IPC for follow-up messages
    ├─ If found → Push to SDK stream
    ├─ If _close sentinel → Exit gracefully
    └─ If idle timeout → Write _close, exit
```

### 2. Scheduled Task Flow

```
1. User creates task via IPC tool
   "Schedule: Send sales report every Monday at 9am"
   ↓
2. Agent calls nanoclaw_schedule_task MCP tool
   ├─ Creates scheduled_task in SQLite
   └─ Sets next_run based on cron expression
   ↓
3. Scheduler polling loop (every 60 seconds)
   SELECT * FROM scheduled_tasks
   WHERE status = 'active'
     AND next_run <= NOW()
   ↓
4. Found due task → Enqueue to GroupQueue
   ↓
5. Spawn container with task prompt
   {
     prompt: "Send sales report",
     sessionId: <group session> or null (isolated),
     isScheduledTask: true,
     ...
   }
   ↓
6. Agent generates report, outputs result
   ↓
7. Result sent to WhatsApp
   ↓
8. Log execution to task_run_logs
   ├─ duration_ms: 45000
   ├─ status: 'success'
   └─ result: "Sales report sent"
   ↓
9. Calculate next run
   ├─ cron: Parse expression, get next date
   ├─ interval: Add milliseconds to now
   └─ once: Set next_run = null, status = 'completed'
   ↓
10. Update task in database
```

### 3. Multi-Turn Conversation Flow (Rapid Messages)

```
1. User sends: "@Andy what's the weather?"
   ↓
2. Container spawns, starts processing
   ↓
3. While processing, user sends: "actually check London"
   ↓
4. index.ts detects active container
   ├─ Writes message to /workspace/ipc/input/{timestamp}.json
   └─ Container's IPC poller picks it up
   ↓
5. Container pushes to MessageStream
   ├─ SDK receives as follow-up message
   └─ Adjusts response: "Weather in London: 15°C"
   ↓
6. Result sent to WhatsApp
   ↓
7. Idle timer starts (30 minutes)
   ├─ If another message → Reset timer, pipe to stream
   └─ If timeout → Write _close, container exits
```

---

## File Structure

```
nanoclaw/
├── src/                          # Main application code
│   ├── index.ts                  # Main process (WhatsApp, routing, IPC)
│   ├── config.ts                 # Configuration constants
│   ├── types.ts                  # TypeScript interfaces
│   ├── db.ts                     # SQLite operations
│   ├── group-queue.ts            # Concurrency & queue management
│   ├── container-runner.ts       # Container spawning & mounts
│   ├── task-scheduler.ts         # Scheduled tasks polling loop
│   ├── mount-security.ts         # Mount allowlist validation
│   ├── logger.ts                 # Pino logger config
│   └── whatsapp-auth.ts          # Standalone QR code auth tool
│
├── container/                    # Container image definition
│   ├── Dockerfile                # Node 22 + Chromium + Claude
│   ├── build.sh                  # Build script (container build -t nanoclaw-agent:latest)
│   │
│   ├── agent-runner/             # Code running inside container
│   │   ├── src/
│   │   │   ├── index.ts          # Main: stdin → SDK → stdout
│   │   │   └── ipc-mcp-stdio.ts  # MCP server for IPC (tasks, messages)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── skills/                   # Skills synced to all containers
│       └── agent-browser/        # Browser automation via Playwright
│           └── SKILL.md          # Skill documentation
│
├── groups/                       # Per-group isolated workspaces
│   ├── main/                     # Main group (your self-chat)
│   │   ├── CLAUDE.md             # Group memory (auto-managed by SDK)
│   │   ├── logs/                 # Container execution logs
│   │   └── conversations/        # Archived full transcripts
│   │
│   ├── global/                   # Global memory (read-only for non-main)
│   │   └── CLAUDE.md
│   │
│   └── {group-folder}/           # Other groups (isolated)
│       ├── CLAUDE.md
│       ├── logs/
│       └── ...
│
├── data/                         # Runtime data (not in container)
│   ├── ipc/                      # IPC directories per group
│   │   └── {group-folder}/
│   │       ├── input/            # Follow-up messages for container
│   │       ├── messages/         # (unused, legacy)
│   │       ├── tasks/            # (unused, legacy)
│   │       ├── current_tasks.json       # Tasks snapshot
│   │       └── available_groups.json    # Groups snapshot
│   │
│   ├── sessions/                 # Claude sessions per group
│   │   └── {group-folder}/
│   │       └── .claude/
│   │           ├── settings.json # SDK config (agent teams, etc.)
│   │           ├── skills/       # Synced from container/skills/
│   │           └── sessions/     # Session transcripts
│   │
│   └── env/                      # Filtered environment variables
│       └── env                   # CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY
│
├── store/                        # Persistent storage
│   ├── messages.db               # SQLite database
│   └── auth_info_baileys/        # WhatsApp session (multi-file auth)
│
├── config-examples/              # Example configurations
│   └── mount-allowlist.json      # Template for ~/.config/nanoclaw/
│
├── launchd/                      # macOS service configuration
│   └── com.nanoclaw.plist        # launchd service definition
│
├── docs/                         # Documentation
│   ├── REQUIREMENTS.md           # Original design philosophy
│   ├── SECURITY.md               # Security model deep dive
│   ├── SDK_DEEP_DIVE.md          # Claude Agent SDK internals
│   ├── DEBUG_CHECKLIST.md        # Common issues & fixes
│   └── SPEC.md                   # Detailed specifications
│
├── .claude/                      # Claude Code skills (host only)
│   └── skills/
│       ├── setup/                # /setup skill
│       ├── customize/            # /customize skill
│       ├── debug/                # /debug skill
│       ├── add-gmail/            # /add-gmail skill
│       ├── add-telegram/         # /add-telegram skill
│       └── ...
│
├── package.json                  # Node.js dependencies
├── tsconfig.json                 # TypeScript configuration
├── .env                          # Environment variables (not committed)
├── .gitignore
└── README.md
```

---

## Key Concepts

### 1. Group Isolation

Each WhatsApp group/chat has its own isolated environment:

```
Group "main" (self-chat):
  ✓ Full project root access
  ✓ Can read/write global memory
  ✓ Can register new groups
  ✓ Can manage all tasks

Group "work-team":
  ✓ Own workspace: groups/work-team/
  ✓ Own Claude session
  ✓ Own CLAUDE.md memory
  ✓ Can read global memory (read-only)
  ✓ Cannot access other groups
  ✓ Cannot see other groups' tasks
```

### 2. Trigger Pattern

Messages must start with `@Andy` (configurable) to trigger the assistant:

```typescript
// Default trigger
const TRIGGER_PATTERN = /^@Andy\b/i;

// User message:
"@Andy what's the weather?"  ✓ Triggers
"Hey @Andy"                  ✓ Triggers (word boundary)
"@andy lowercase works"      ✓ Triggers (case insensitive)
"Message @Andy in middle"    ✗ Does not trigger (must start)

// Solo chats can disable trigger requirement:
{
  requiresTrigger: false  // Responds to all messages
}
```

### 3. Session Continuity

Claude sessions persist across messages within the same group:

```
Message 1: "@Andy remember my favorite color is blue"
  → Session: abc123
  → Response: "Got it, I'll remember that."

[5 minutes later]

Message 2: "@Andy what's my favorite color?"
  → Session: abc123 (same session)
  → Response: "Your favorite color is blue."
  → Claude has full conversation history
```

### 4. Streaming vs Batch Mode

**Streaming Mode** (default for messages):
- Results sent to WhatsApp as they arrive
- Container stays alive for follow-up messages
- Idle timeout: 30 minutes of no output
- Enables rapid multi-turn conversations

**Batch Mode** (legacy, still supported):
- Waits for container to exit
- Returns final result only
- Used for simple one-shot queries

### 5. Message Piping

When a container is active and a new message arrives:

```
Container active, processing message A
User sends message B while A is processing
  ↓
Instead of spawning new container:
  1. Write B to /workspace/ipc/input/{timestamp}.json
  2. Container's IPC poller detects file
  3. Pushes B to MessageStream
  4. SDK receives as follow-up
  5. Adjusts response based on both A and B
```

This enables real-time conversation without spawning multiple containers.

### 6. IPC Mechanism

**Three IPC channels**:

1. **Stdin → Stdout** (initial query)
   ```
   Host: Write JSON to container stdin
   Container: Read stdin, run query, write JSON to stdout
   Host: Parse stdout for results
   ```

2. **IPC Files** (follow-up messages)
   ```
   Host: Write /workspace/ipc/input/{timestamp}.json
   Container: Poll directory, read files, push to stream
   ```

3. **MCP Tools** (container → host actions)
   ```
   Container: SDK calls nanoclaw_send_message MCP tool
   Host: IPC MCP server writes to /workspace/ipc/messages/
   Container: Reads response
   Host: index.ts polls /workspace/ipc/messages/, sends to WhatsApp
   ```

### 7. Task Context Modes

**Isolated Mode**:
```typescript
{
  context_mode: 'isolated'
  sessionId: undefined  // New session each run
}

Use cases:
- Daily reports (fresh context each day)
- Stateless monitoring tasks
- Independent scheduled actions
```

**Group Mode**:
```typescript
{
  context_mode: 'group'
  sessionId: sessions[task.group_folder]  // Uses group's session
}

Use cases:
- Ongoing projects (remembers previous runs)
- Incremental updates
- Conversations spanning multiple executions
```

---

## Security Model

### 1. Container Isolation

**OS-Level Isolation**:
- Agents run in Linux VMs (Apple Container) or Docker containers
- Cannot access host filesystem except explicitly mounted directories
- Cannot access network except via mounted tools (web_search, etc.)
- Non-root user inside container (user `node`)

**Mount Security**:
```
Main Group:
  ✓ /workspace/project → entire project root (read-write)
  ✓ /workspace/group → groups/main/ (read-write)
  ✓ Additional mounts validated against allowlist

Other Groups:
  ✓ /workspace/group → groups/{folder}/ (read-write)
  ✓ /workspace/global → groups/global/ (read-only)
  ✓ Additional mounts forced to read-only (configurable)
  ✗ No access to project root
  ✗ No access to other groups
```

### 2. Allowlist Security

**Tamper-Proof Location**:
```
~/.config/nanoclaw/mount-allowlist.json
  ✗ Never mounted into any container
  ✗ Containers cannot modify
  ✓ Only host process can read
```

**Blocked Patterns**:
```typescript
// Always blocked, even if under allowed root
['.ssh', '.gnupg', '.aws', '.env', 'credentials', ...]
```

**Validation Levels**:
1. Path must exist on host
2. Must not match blocked pattern
3. Must be under an allowed root
4. Read-write requires root permission + main group

### 3. IPC Isolation

**Per-Group IPC**:
```
data/ipc/main/          → Only main group sees this
data/ipc/work-team/     → Only work-team sees this
```

**Prevents**:
- Group A sending messages to Group B's container
- Group B reading Group A's tasks
- Cross-group privilege escalation

### 4. Environment Variable Filtering

Only safe credentials mounted into containers:
```typescript
// .env on host (sensitive):
WHATSAPP_AUTH_KEY=...
DATABASE_PASSWORD=...
CLAUDE_CODE_OAUTH_TOKEN=...
ANTHROPIC_API_KEY=...

// /workspace/env-dir/env in container (filtered):
CLAUDE_CODE_OAUTH_TOKEN=...
ANTHROPIC_API_KEY=...
```

### 5. LID JID Handling

WhatsApp now uses LID format for some chats, translation required:
```typescript
// LID JID (new format):
"0:1234567890@lid"

// Phone JID (traditional):
"1234567890@s.whatsapp.net"

// Translation:
lidToPhoneMap['0:1234567890'] = '1234567890@s.whatsapp.net'
```

This prevents group registration failures when WhatsApp uses LID format.

---

## Execution Flow

### Startup Sequence

```
1. Load environment variables from .env
   ├─ CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY
   ├─ ASSISTANT_NAME (default: "Andy")
   └─ LOG_LEVEL (default: "info")

2. Initialize SQLite database
   ├─ Create tables if not exist
   ├─ Migrate from JSON files if present
   └─ Load state into memory

3. Connect to WhatsApp
   ├─ Load multi-file auth from store/auth_info_baileys/
   ├─ If no auth → Show QR code
   └─ On connection → Sync group metadata

4. Start background loops
   ├─ Message polling loop (every 2 seconds)
   ├─ Task scheduler loop (every 60 seconds)
   ├─ IPC watcher loop (every 1 second)
   └─ Group metadata sync (daily)

5. Register signal handlers
   ├─ SIGINT/SIGTERM → Graceful shutdown
   └─ SIGHUP → Reload configuration
```

### Message Processing (Detailed)

```
1. Baileys emits 'messages.upsert' event
   ↓
2. For each message in batch:
   ├─ Extract: id, chat_jid, sender, content, timestamp
   ├─ Translate LID JID to phone JID if needed
   ├─ Store chat metadata (all chats)
   └─ If registered group → Store full message

3. Message polling loop wakes up (every 2 seconds)
   ↓
4. Query database:
   SELECT * FROM messages
   WHERE timestamp > last_timestamp
     AND chat_jid IN (registered_jids)
     AND content NOT LIKE 'Andy:%'  -- Exclude bot's own messages
   ↓
5. Group messages by chat_jid
   ↓
6. For each group with new messages:
   ├─ Check if trigger pattern present (if required)
   ├─ If no trigger → Skip
   └─ If trigger → queue.enqueueMessageCheck(jid)
   ↓
7. GroupQueue.enqueueMessageCheck(jid)
   ├─ If container active → Set pendingMessages flag
   ├─ If at concurrency limit → Add to waitingGroups
   └─ If available → runForGroup(jid, 'messages')
   ↓
8. processGroupMessages(jid)
   ├─ Get missed messages since last agent interaction
   ├─ Format as XML: <messages><message>...</message></messages>
   ├─ Advance cursor (lastAgentTimestamp)
   └─ Spawn container via runContainerAgent()
   ↓
9. Container spawns, processes, outputs results
   ↓
10. Results streamed back to WhatsApp
   ├─ Parse OUTPUT_START/END markers
   ├─ Strip <internal> tags
   ├─ Send via sock.sendMessage()
   └─ Reset idle timeout
   ↓
11. Container polls IPC for follow-up messages
   ├─ If found → Push to stream, generate more results
   ├─ If idle timeout → Write _close, exit gracefully
   └─ If _close sentinel → Exit gracefully
```

### Task Execution (Detailed)

```
1. Scheduler loop wakes up (every 60 seconds)
   ↓
2. Query database:
   SELECT * FROM scheduled_tasks
   WHERE status = 'active'
     AND next_run IS NOT NULL
     AND next_run <= NOW()
   ORDER BY next_run
   ↓
3. For each due task:
   ├─ Re-check status (may have been paused/deleted)
   ├─ If still active → queue.enqueueTask(jid, taskId, runTask)
   └─ If not active → Skip
   ↓
4. GroupQueue.enqueueTask()
   ├─ Check for duplicate task (same taskId already queued)
   ├─ If container active → Add to pendingTasks
   ├─ If at limit → Add to pendingTasks + waitingGroups
   └─ If available → runTask(task)
   ↓
5. runTask(task)
   ├─ Find group config from task.group_folder
   ├─ Write tasks snapshot to IPC
   ├─ Determine sessionId (group mode vs isolated)
   └─ Spawn container with task.prompt
   ↓
6. Container processes task
   ↓
7. Results streamed back
   ├─ Strip <internal> tags
   ├─ Send to WhatsApp at task.chat_jid
   └─ Accumulate result text
   ↓
8. Log execution
   INSERT INTO task_run_logs
   (task_id, run_at, duration_ms, status, result, error)
   ↓
9. Calculate next run
   ├─ cron: Parse expression with timezone, get next date
   ├─ interval: Add milliseconds to now
   └─ once: Set next_run = null, status = 'completed'
   ↓
10. Update task
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = ?
    WHERE id = ?
```

---

## Database Schema

### Full Schema with Indexes

```sql
-- Chat metadata (all conversations)
CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT
);

-- Message content (registered groups only)
CREATE TABLE messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  PRIMARY KEY (id, chat_jid),
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);
CREATE INDEX idx_timestamp ON messages(timestamp);

-- Registered groups configuration
CREATE TABLE registered_groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  trigger_pattern TEXT NOT NULL,
  added_at TEXT NOT NULL,
  container_config TEXT,        -- JSON string
  requires_trigger INTEGER DEFAULT 1
);

-- Scheduled tasks
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  context_mode TEXT DEFAULT 'isolated',
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_next_run ON scheduled_tasks(next_run);
CREATE INDEX idx_status ON scheduled_tasks(status);

-- Task execution logs
CREATE TABLE task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
CREATE INDEX idx_task_run_logs ON task_run_logs(task_id, run_at);

-- Claude session state
CREATE TABLE sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

-- Router state (misc key-value)
CREATE TABLE router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Common Queries

```sql
-- Get new messages for registered groups
SELECT id, chat_jid, sender, sender_name, content, timestamp
FROM messages
WHERE timestamp > ?
  AND chat_jid IN (?, ?, ...)
  AND content NOT LIKE 'Andy:%'
ORDER BY timestamp;

-- Get due tasks
SELECT * FROM scheduled_tasks
WHERE status = 'active'
  AND next_run IS NOT NULL
  AND next_run <= ?
ORDER BY next_run;

-- Get task history
SELECT * FROM task_run_logs
WHERE task_id = ?
ORDER BY run_at DESC
LIMIT 10;

-- Get all groups by recent activity
SELECT jid, name, last_message_time
FROM chats
WHERE jid LIKE '%@g.us'
ORDER BY last_message_time DESC;
```

---

## IPC Mechanism

### 1. Stdin/Stdout Protocol

**Input** (written by host to container stdin):
```json
{
  "prompt": "<messages><message sender=\"User\" time=\"...\">Hello</message></messages>",
  "sessionId": "abc123",
  "groupFolder": "main",
  "chatJid": "1234567890@s.whatsapp.net",
  "isMain": true,
  "isScheduledTask": false
}
```

**Output** (written by container to stdout):
```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"Hello! How can I help?","newSessionId":"abc456"}
---NANOCLAW_OUTPUT_END---
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"I'm ready for your next message.","newSessionId":"abc456"}
---NANOCLAW_OUTPUT_END---
```

### 2. IPC Files Protocol

**Directory Structure**:
```
/workspace/ipc/
├── input/                 # Host → Container
│   ├── 1707584000000-a1b2.json
│   ├── 1707584005000-c3d4.json
│   └── _close             # Sentinel to close stdin
├── messages/              # Container → Host (via MCP)
│   └── 1707584010000-e5f6.json
└── tasks/                 # Container → Host (via MCP)
    └── 1707584015000-g7h8.json
```

**Input Message**:
```json
{
  "type": "message",
  "text": "actually check London instead"
}
```

**Close Sentinel**:
```bash
touch /workspace/ipc/input/_close
# Container detects this and calls messageStream.end()
```

**Output Message** (via MCP tool):
```json
{
  "type": "send_message",
  "text": "Message to send to WhatsApp",
  "jid": "1234567890@s.whatsapp.net"
}
```

### 3. MCP Tools (Container → Host)

Located in `container/agent-runner/src/ipc-mcp-stdio.ts`:

```typescript
tools: [
  {
    name: "nanoclaw_send_message",
    description: "Send a message to a WhatsApp chat",
    inputSchema: {
      chatJid: { type: "string" },
      text: { type: "string" }
    }
  },
  {
    name: "nanoclaw_schedule_task",
    description: "Create a scheduled task",
    inputSchema: {
      prompt: { type: "string" },
      schedule: { type: "string" },  // cron or interval
      contextMode: { enum: ["group", "isolated"] }
    }
  },
  {
    name: "nanoclaw_list_tasks",
    description: "List scheduled tasks (filtered by group)"
  },
  {
    name: "nanoclaw_pause_task",
    description: "Pause a scheduled task"
  },
  {
    name: "nanoclaw_resume_task",
    description: "Resume a paused task"
  },
  {
    name: "nanoclaw_delete_task",
    description: "Delete a scheduled task"
  },
  {
    name: "nanoclaw_register_group",
    description: "Register a new group (main only)"
  },
  {
    name: "nanoclaw_list_groups",
    description: "List available groups (main only)"
  }
]
```

**Example Tool Call Flow**:
```
1. Agent calls nanoclaw_send_message MCP tool
   ↓
2. MCP server writes to /workspace/ipc/messages/{timestamp}.json
   {
     "toolCallId": "call_123",
     "type": "send_message",
     "chatJid": "...",
     "text": "Hello from agent"
   }
   ↓
3. Host's IPC watcher detects file
   ↓
4. Reads file, sends to WhatsApp
   sock.sendMessage(chatJid, { text })
   ↓
5. Writes response to /workspace/ipc/messages/{timestamp}-response.json
   {
     "toolCallId": "call_123",
     "success": true
   }
   ↓
6. MCP server reads response, returns to SDK
   ↓
7. Agent continues with next action
```

---

## Skills System

### Host Skills (.claude/skills/)

Located at `.claude/skills/` (host only, not in containers):

```
.claude/skills/
├── setup/SKILL.md           # Initial setup wizard
├── customize/SKILL.md       # Guided customization
├── debug/SKILL.md           # Troubleshooting assistant
├── add-gmail/SKILL.md       # Add Gmail integration
├── add-telegram/SKILL.md    # Add Telegram channel
└── ...
```

**Purpose**: Transform the codebase for user's specific needs

**Example** (`/add-telegram`):
1. Install dependencies: `npm install node-telegram-bot-api`
2. Modify `src/index.ts`: Add Telegram connection
3. Create `src/telegram-handler.ts`: Message routing
4. Update `.env.example`: Add `TELEGRAM_BOT_TOKEN`
5. Update README: Document Telegram setup

**Philosophy**: Skills modify code, not add configuration

### Container Skills (container/skills/)

Located at `container/skills/` (synced to all containers):

```
container/skills/
└── agent-browser/
    ├── SKILL.md             # Skill documentation
    ├── lib/
    │   ├── browser.ts       # Playwright wrapper
    │   └── config.ts        # Browser configuration
    └── scripts/
        ├── navigate.ts      # Browser navigation
        ├── screenshot.ts    # Capture screenshot
        └── scrape.ts        # Extract data
```

**Purpose**: Extend agent capabilities inside containers

**How It Works**:
1. Skills stored in `container/skills/`
2. On container spawn, synced to `data/sessions/{group}/.claude/skills/`
3. Claude SDK automatically loads skills from `.claude/skills/`
4. Agent can use skill commands: `/agent-browser`

**Example Usage**:
```
User: "@Andy /agent-browser navigate to google.com and screenshot"
Agent: *Uses agent-browser skill*
       *Launches Chromium via Playwright*
       *Takes screenshot, saves to group folder*
       "Screenshot saved to screenshot.png"
```

---

## Configuration

### Environment Variables (.env)

```bash
# Required: Claude authentication
CLAUDE_CODE_OAUTH_TOKEN=...      # OAuth token from Claude Code
# OR
ANTHROPIC_API_KEY=...            # API key (alternative to OAuth)

# Optional: Customization
ASSISTANT_NAME=Andy              # Trigger word (default: Andy)
LOG_LEVEL=info                   # Logging level (debug, info, warn, error)

# Optional: Container settings
CONTAINER_IMAGE=nanoclaw-agent:latest
CONTAINER_TIMEOUT=1800000        # 30 minutes (milliseconds)
IDLE_TIMEOUT=1800000             # 30 minutes (milliseconds)
MAX_CONCURRENT_CONTAINERS=5      # Global concurrency limit
CONTAINER_MAX_OUTPUT_SIZE=10485760  # 10MB max output

# WhatsApp (managed by baileys, stored in store/auth_info_baileys/)
# No manual configuration needed
```

### Constants (src/config.ts)

```typescript
export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;              // Message polling: 2 seconds
export const SCHEDULER_POLL_INTERVAL = 60000;   // Task polling: 60 seconds
export const IPC_POLL_INTERVAL = 1000;          // IPC watcher: 1 second
export const IDLE_TIMEOUT = 1800000;            // 30 minutes
export const CONTAINER_TIMEOUT = 1800000;       // 30 minutes
export const MAX_CONCURRENT_CONTAINERS = 5;

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i'
);

export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
```

### Mount Allowlist (~/.config/nanoclaw/mount-allowlist.json)

```json
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    },
    {
      "path": "~/Documents",
      "allowReadWrite": false,
      "description": "Documents (read-only)"
    }
  ],
  "blockedPatterns": [
    ".ssh",
    ".gnupg",
    "credentials",
    "password",
    "secret"
  ],
  "nonMainReadOnly": true
}
```

### Group Configuration (in database)

```typescript
interface RegisteredGroup {
  name: string;              // Display name
  folder: string;            // Filesystem folder name
  trigger: string;           // Trigger pattern (regex)
  added_at: string;          // ISO timestamp
  requiresTrigger?: boolean; // Default: true
  containerConfig?: {
    timeout?: number;        // Override default timeout
    additionalMounts?: Array<{
      hostPath: string;      // Path on host (~/projects/myapp)
      containerPath?: string; // Name in container (defaults to basename)
      readonly?: boolean;    // Default: true
    }>
  }
}
```

**Example**:
```typescript
{
  name: "Work Team",
  folder: "work-team",
  trigger: "^@Andy\\b",
  added_at: "2026-02-10T12:00:00Z",
  requiresTrigger: true,
  containerConfig: {
    timeout: 3600000,  // 60 minutes for long tasks
    additionalMounts: [
      {
        hostPath: "~/projects/work-app",
        containerPath: "work-app",
        readonly: false
      },
      {
        hostPath: "~/Documents/contracts",
        readonly: true  // Force read-only
      }
    ]
  }
}
```

---

## Conclusion

This breakdown covers the complete NanoClaw architecture. The system is designed to be:

1. **Understandable**: All code fits in your head
2. **Secure**: OS-level isolation, not permission checks
3. **Customizable**: Modify code directly, not endless configs
4. **Reliable**: Simple state machine, predictable behavior
5. **Extensible**: Skills add capabilities without bloat

**Key Files to Read**:
- `src/index.ts` (400 lines) - Main orchestration
- `src/group-queue.ts` (300 lines) - Queue management
- `src/container-runner.ts` (600 lines) - Container spawning
- `container/agent-runner/src/index.ts` (400 lines) - Container code

**Total Core**: ~1,700 lines of TypeScript

Everything else is tooling, skills, and documentation. The simplicity is intentional.
