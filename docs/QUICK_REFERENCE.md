# NanoClaw Quick Reference

**Quick lookup for common tasks, commands, and concepts**

Last updated: 2026-02-10

---

## 🚀 Quick Start Commands

```bash
# Development
npm run dev              # Run with hot reload
npm run build            # Compile TypeScript
npm start                # Run compiled code

# Container
./container/build.sh     # Build container image
container images         # List images

# WhatsApp Auth
npm run auth             # Show QR code for WhatsApp

# Service Management (macOS)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl list | grep nanoclaw

# Service Management (Linux)
sudo systemctl start nanoclaw
sudo systemctl stop nanoclaw
sudo systemctl status nanoclaw
journalctl -u nanoclaw -f
```

---

## 📁 File Locations

| What | Where |
|------|-------|
| **Main code** | `src/index.ts` |
| **Container code** | `container/agent-runner/src/index.ts` |
| **Database** | `store/messages.db` |
| **WhatsApp auth** | `store/auth_info_baileys/` |
| **Group workspaces** | `groups/{group-name}/` |
| **Container logs** | `groups/{group-name}/logs/` |
| **Mount allowlist** | `~/.config/nanoclaw/mount-allowlist.json` |
| **Environment** | `.env` (root directory) |
| **Skills (host)** | `.claude/skills/` |
| **Skills (container)** | `container/skills/` |

---

## 🔧 Configuration

### Environment Variables (.env)

```bash
# Required
CLAUDE_CODE_OAUTH_TOKEN=...   # OR
ANTHROPIC_API_KEY=...

# Optional
ASSISTANT_NAME=Andy           # Default trigger word
LOG_LEVEL=info                # debug|info|warn|error
MAX_CONCURRENT_CONTAINERS=5   # Global limit
CONTAINER_TIMEOUT=1800000     # 30 minutes (ms)
IDLE_TIMEOUT=1800000          # 30 minutes (ms)
```

### Key Constants (src/config.ts)

```typescript
POLL_INTERVAL = 2000              // Message polling (2 sec)
SCHEDULER_POLL_INTERVAL = 60000   // Task polling (60 sec)
IPC_POLL_INTERVAL = 1000          // IPC watcher (1 sec)
MAX_CONCURRENT_CONTAINERS = 5     // Global concurrency
```

---

## 💬 Message Format

### User Message (WhatsApp)

```
@Andy what's the weather in London?
```

### Formatted for Container (XML)

```xml
<messages>
  <message sender="John" time="2026-02-10T12:00:00Z">
    @Andy what's the weather in London?
  </message>
</messages>
```

### Agent Response

```
Andy: The current weather in London is 15°C with partly cloudy skies.
```

---

## 🗄️ Database Tables

### Key Tables

```sql
-- Messages (registered groups only)
messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me)

-- Groups configuration
registered_groups (jid, name, folder, trigger_pattern, container_config, requires_trigger)

-- Scheduled tasks
scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, 
                 context_mode, next_run, status)

-- Chat metadata (all chats)
chats (jid, name, last_message_time)

-- Claude sessions
sessions (group_folder, session_id)

-- Router state
router_state (key, value)
```

### Common Queries

```sql
-- Get new messages
SELECT * FROM messages 
WHERE timestamp > ? AND chat_jid IN (?)
  AND content NOT LIKE 'Andy:%';

-- Get due tasks
SELECT * FROM scheduled_tasks
WHERE status = 'active' AND next_run <= ?;

-- Get all groups by activity
SELECT * FROM chats 
WHERE jid LIKE '%@g.us'
ORDER BY last_message_time DESC;
```

---

## 🐳 Container Commands

### Build & Manage

```bash
# Build image
./container/build.sh

# Verify build
container images | grep nanoclaw-agent

# Test container manually
echo '{"prompt":"test","groupFolder":"main"}' | \
  container run -i --rm nanoclaw-agent:latest

# List running containers
container ps

# Stop container
container stop {container-name}

# Clean up
container system prune
```

### Troubleshooting Container Build Cache

```bash
# Apple Container caches aggressively - force clean rebuild:
container builder stop
container builder rm
container builder start
./container/build.sh
```

---

## 📋 Task Scheduling

### Schedule Types

```typescript
// Cron expression (timezone-aware)
{
  schedule_type: 'cron',
  schedule_value: '0 9 * * 1-5'  // Weekdays at 9am
}

// Interval in milliseconds
{
  schedule_type: 'interval',
  schedule_value: '3600000'      // Every hour
}

// One-time execution
{
  schedule_type: 'once',
  schedule_value: '2026-02-20T15:00:00Z'
}
```

### Cron Examples

```
0 9 * * 1-5    # Weekdays at 9am
0 0 * * *      # Daily at midnight
0 */4 * * *    # Every 4 hours
0 9 1 * *      # First day of month at 9am
0 0 * * 0      # Sundays at midnight
```

### Context Modes

```typescript
// Isolated: New session each run (stateless)
context_mode: 'isolated'

// Group: Use group's session (stateful)
context_mode: 'group'
```

---

## 🔐 Security Cheat Sheet

### What Containers Can See

**Main Group:**
- ✅ Entire project (`/workspace/project`)
- ✅ Own workspace (`/workspace/group`)
- ✅ Global memory (`/workspace/global`)
- ✅ IPC directory (isolated)
- ✅ Additional mounts (validated)

**Other Groups:**
- ✅ Own workspace only (`/workspace/group`)
- ✅ Global memory (read-only)
- ✅ IPC directory (isolated)
- ✅ Additional mounts (validated, read-only by default)
- ❌ Project root
- ❌ Other groups' workspaces

### Always Blocked Patterns

```
.ssh, .gnupg, .aws, .azure, .kube, .docker,
credentials, .env, .netrc, id_rsa, private_key, .secret
```

### Mount Allowlist Template

```json
{
  "allowedRoots": [
    {
      "path": "~/projects",
      "allowReadWrite": true,
      "description": "Development projects"
    }
  ],
  "blockedPatterns": ["password", "secret"],
  "nonMainReadOnly": true
}
```

---

## 🛠️ MCP Tools (Available in Containers)

### Message Tools

```typescript
// Send WhatsApp message
nanoclaw_send_message({
  chatJid: "1234567890@s.whatsapp.net",
  text: "Hello from agent"
})
```

### Task Tools

```typescript
// Create task
nanoclaw_schedule_task({
  prompt: "Send report",
  schedule: "0 9 * * 1",  // Monday 9am
  contextMode: "group"
})

// List tasks
nanoclaw_list_tasks()

// Manage tasks
nanoclaw_pause_task({ taskId: "..." })
nanoclaw_resume_task({ taskId: "..." })
nanoclaw_delete_task({ taskId: "..." })
```

### Group Tools (Main Only)

```typescript
// List available groups
nanoclaw_list_groups()

// Register group
nanoclaw_register_group({
  jid: "12345@g.us",
  name: "Work Team",
  folder: "work-team"
})
```

---

## 🔍 Debugging

### Check Logs

```bash
# Container logs (per execution)
ls -lt groups/main/logs/
cat groups/main/logs/container-*.log

# Application logs
LOG_LEVEL=debug npm run dev

# Service logs (macOS)
log stream --predicate 'process == "node"' --info

# Service logs (Linux)
journalctl -u nanoclaw -f
```

### Common Issues

**Container won't spawn:**
```bash
# Check image exists
container images | grep nanoclaw-agent

# Rebuild if needed
./container/build.sh

# Check logs
LOG_LEVEL=debug npm run dev
```

**WhatsApp disconnects:**
```bash
# Re-authenticate
npm run auth

# Check auth files
ls store/auth_info_baileys/
```

**Task not running:**
```sql
-- Check task status
SELECT * FROM scheduled_tasks WHERE id = '...';

-- Check next run time
SELECT id, next_run, status FROM scheduled_tasks;

-- Check task logs
SELECT * FROM task_run_logs WHERE task_id = '...' ORDER BY run_at DESC;
```

**Mount validation fails:**
```bash
# Check allowlist exists
cat ~/.config/nanoclaw/mount-allowlist.json

# Create from template
mkdir -p ~/.config/nanoclaw
cp config-examples/mount-allowlist.json ~/.config/nanoclaw/
```

---

## 📊 Monitoring

### Check System Status

```bash
# Running containers
container ps

# Database size
du -h store/messages.db

# Group activity
sqlite3 store/messages.db "
  SELECT jid, name, last_message_time 
  FROM chats 
  WHERE jid LIKE '%@g.us' 
  ORDER BY last_message_time DESC 
  LIMIT 10;
"

# Recent tasks
sqlite3 store/messages.db "
  SELECT task_id, run_at, status, duration_ms
  FROM task_run_logs
  ORDER BY run_at DESC
  LIMIT 10;
"
```

### Performance Metrics

```sql
-- Message volume
SELECT COUNT(*), chat_jid 
FROM messages 
GROUP BY chat_jid;

-- Task execution stats
SELECT 
  task_id,
  COUNT(*) as runs,
  AVG(duration_ms) as avg_duration,
  SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors
FROM task_run_logs
GROUP BY task_id;
```

---

## 🎯 Common Patterns

### Register New Group

**In main/self-chat WhatsApp:**
```
@Andy list available groups
@Andy register the "Work Team" group
```

### Schedule Task

**In any registered group:**
```
@Andy schedule: send daily standup summary every weekday at 9am
@Andy schedule: check website status every 30 minutes
@Andy list my scheduled tasks
@Andy pause the standup task
```

### Multi-Turn Conversation

**Rapid messages (same container):**
```
@Andy what's the weather?
actually check London
what about tomorrow?
thanks!
```

### Add Mount

**In main group, edit registered group:**
```typescript
// Via MCP tool or direct DB edit
UPDATE registered_groups
SET container_config = json_set(
  container_config,
  '$.additionalMounts',
  json_array(json_object(
    'hostPath', '~/projects/myapp',
    'readonly', 0
  ))
)
WHERE folder = 'work-team';
```

---

## 🧪 Testing

### Manual Container Test

```bash
# Test basic execution
echo '{"prompt":"Hello","groupFolder":"test"}' | \
  container run -i --rm \
    -v "$(pwd)/groups/main:/workspace/group" \
    nanoclaw-agent:latest

# Test with session
echo '{
  "prompt": "Remember: my name is Alice",
  "sessionId": "test-123",
  "groupFolder": "main"
}' | container run -i --rm \
  -v "$(pwd)/groups/main:/workspace/group" \
  -v "$(pwd)/data/sessions/main/.claude:/home/node/.claude" \
  nanoclaw-agent:latest
```

### Test Database Queries

```bash
# Interactive SQLite
sqlite3 store/messages.db

# Check tables
.tables

# Describe schema
.schema messages

# Test query
SELECT * FROM messages ORDER BY timestamp DESC LIMIT 5;
```

### Test WhatsApp Connection

```bash
# Start with debug logging
LOG_LEVEL=debug npm run dev

# Send test message to yourself
# Look for events in console
```

---

## 📚 Key Concepts (Quick Summary)

| Concept | What It Is |
|---------|------------|
| **Trigger Pattern** | `@Andy` prefix required for messages (configurable) |
| **Group Isolation** | Each group has separate workspace, memory, IPC |
| **Session Continuity** | Conversations persist across messages |
| **Streaming Mode** | Results sent as generated, container stays alive |
| **IPC** | File-based communication (stdin, files, MCP tools) |
| **Mount Allowlist** | External tamper-proof validation of mounts |
| **Context Mode** | `group` (stateful) vs `isolated` (stateless) tasks |
| **Idle Timeout** | 30 min of no output → container exits |
| **Global Concurrency** | Max 5 containers running simultaneously |

---

## 🔗 Related Documentation

- **[CODEBASE_BREAKDOWN.md](CODEBASE_BREAKDOWN.md)** - Complete technical breakdown
- **[VISUAL_GUIDE.md](VISUAL_GUIDE.md)** - Architecture diagrams
- **[REQUIREMENTS.md](REQUIREMENTS.md)** - Design philosophy
- **[SECURITY.md](SECURITY.md)** - Security model deep dive
- **[SDK_DEEP_DIVE.md](SDK_DEEP_DIVE.md)** - Claude Agent SDK internals

---

## 💡 Tips & Tricks

### Quick Rebuild

```bash
# Fast iteration during development
npm run build && npm start
```

### Clear Old Sessions

```bash
# Clean up old session data (keeps current)
find data/sessions -name "*.md" -mtime +30 -delete
```

### Export Database

```bash
# Backup
cp store/messages.db store/messages-backup-$(date +%Y%m%d).db

# Export as SQL
sqlite3 store/messages.db .dump > backup.sql
```

### Monitor Container Logs Live

```bash
# Watch most recent log
watch -n 1 'tail -20 $(ls -t groups/main/logs/*.log | head -1)'
```

### Test Mount Allowlist

```typescript
// In container code (temporary debug)
import { validateMount } from './mount-security.js';

const result = validateMount({
  hostPath: '~/projects/test',
  readonly: false
}, false);

console.log(result);
```

---

## 🚨 Emergency Commands

### Stop Everything

```bash
# Kill all containers
container ps -q | xargs -r container stop

# Stop service (macOS)
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# Stop service (Linux)
sudo systemctl stop nanoclaw
```

### Reset Database

```bash
# Backup first!
cp store/messages.db store/messages-backup.db

# Delete and restart (will recreate)
rm store/messages.db
npm start
```

### Reset WhatsApp Auth

```bash
# Backup session
cp -r store/auth_info_baileys store/auth_info_baileys-backup

# Remove auth
rm -rf store/auth_info_baileys

# Re-authenticate
npm run auth
```

---

This quick reference should help you navigate NanoClaw efficiently. For deeper understanding, see the full documentation files.
