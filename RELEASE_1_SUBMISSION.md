# Auto-Ops Sentinel - Software Engineering Lab Release 1 Submission

## 2. PROBLEM STATEMENT

**Real-World Problem:**
Modern software systems rely on dozens of microservices, APIs, and infrastructure components. When failures occur, engineering teams face a critical visibility gap:

- **Detection Delay:** Services fail silently until users complain on social media or support tickets pile up
- **Reactive Debugging:** Engineers spend 2-4 hours manually checking logs, metrics, and dashboards to identify root causes
- **Context Loss:** Incident information is scattered across Slack, email, and monitoring tools
- **Knowledge Gaps:** Junior engineers lack the experience to quickly diagnose complex distributed system failures

**Who Faces This Problem:**
- DevOps/SRE teams responsible for system reliability
- Engineering managers tracking service health
- On-call engineers responding to production incidents
- Small teams without dedicated 24/7 monitoring staff

**Why Existing Solutions Are Insufficient:**
- **Basic Uptime Monitors** (UptimeRobot, Pingdom): Only alert "service down" without explaining WHY
- **Complex APM Tools** (DataDog, New Relic): Expensive, steep learning curve, require extensive configuration
- **Log Analysis Platforms:** Reactive - require manual query writing after incidents occur
- **Generic AI Assistants:** Lack context about specific monitor configurations and historical incidents

**Impact of Unsolved Problem:**
- Average MTTR (Mean Time To Resolution) of 4+ hours for critical incidents
- Revenue loss during outages (estimated $5,600/minute for e-commerce)
- Engineer burnout from repetitive on-call debugging
- Customer churn due to unreliable services

---

## 3. PROPOSED SOLUTION

**Auto-Ops Sentinel** - An AI-powered DevOps monitoring platform that acts as an "automated Site Reliability Engineer."

**Core Capabilities:**
1. **Multi-Protocol Monitoring** - HTTP APIs, TCP ports, DNS, WebSockets, Docker containers, and more
2. **Intelligent Incident Detection** - Automatic incident creation, classification, and lifecycle management
3. **AI-Powered Root Cause Analysis** - Local LLM integration for intelligent failure analysis
4. **Actionable Fix Suggestions** - Specific remediation steps, not generic advice
5. **Unified Dashboard** - Real-time status, incident timeline, and chat-based analyst interface

**How It Addresses the Problem:**
- **Instant Detection:** 5-second scheduler checks all monitors continuously
- **Automatic Analysis:** AI analyzes failures immediately, providing root cause in < 30 seconds
- **Context Preservation:** Full incident history with prompts, responses, and evidence stored in PostgreSQL
- **Accessible Insights:** Natural language queries via Chat Analyst interface

**Novelty & Advantages:**
- **Privacy-First AI:** Uses local Ollama models (Mistral, Llama) - no data leaves the network
- **Fallback Engine:** Rule-based analysis works even without AI (demonstrates robustness)
- **Structured Intelligence:** AI returns structured JSON (root cause, impact, fixes) - not vague text
- **Job Queue Architecture:** Scalable worker system for concurrent monitoring

**Expected Impact:**
- Reduce MTTR from hours to minutes through AI-assisted diagnosis
- Enable junior engineers to handle incidents with AI guidance
- Zero-config intelligent analysis - works out of the box

---

## 4. SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (React + Vite)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   Dashboard  │  │   Chat       │  │   Incident       │   │
│  │   (Status)   │  │   Analyst    │  │   Timeline       │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└──────────────────────────┬────────────────────────────────────┘
                           │ HTTP/WebSocket
┌──────────────────────────▼────────────────────────────────────┐
│                   BACKEND (Node.js + Express)                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  Monitor Engine  │  │  Incident Mgr    │  │  Job Queue   │ │
│  │  (Check types)   │  │  (State machine) │  │  (Priority)  │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Signal Analyst  │  │  Notification    │                    │
│  │  (AI/SLM Module) │  │  (Webhooks)      │                    │
│  └──────────────────┘  └──────────────────┘                    │
└──────────────────────────┬────────────────────────────────────┘
                           │ SQL
┌──────────────────────────▼────────────────────────────────────┐
│              DATABASE (PostgreSQL)                             │
│  monitors │ checks │ incidents │ analyses │ jobs │ activity   │
└───────────────────────────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   Ollama    │
                    │  (Mistral)  │
                    └─────────────┘
```

**Component Descriptions:**

**Frontend (React + TypeScript + Tailwind):**
- Real-time dashboard showing monitor status
- Chat Analyst interface for natural language queries
- Incident timeline with severity indicators
- Signal Analyst panel showing AI analysis results

**Backend (Node.js + Express):**
- **Monitor Engine:** 10 check types (HTTP, TCP, DNS, WebSocket, etc.)
- **Incident Manager:** State machine (open → updated → resolved)
- **Job Queue:** PostgreSQL-backed priority queue for scalable execution
- **Signal Analyst:** LLM integration with fallback rule engine
- **Notification Service:** Webhook delivery for alerts

**Database (PostgreSQL):**
- Stores all monitors, checks, incidents, and AI analyses
- Full-text search for incident retrieval
- Job queue persistence for reliability

**AI Layer (Ollama):**
- Local LLM server (Mistral 7B model)
- Structured prompt engineering for consistent JSON output
- Privacy-preserving (no data sent to external APIs)

**Key Design Decisions:**
- **Job Queue over Simple Loop:** Enables concurrent execution and crash recovery
- **Fallback Mode:** System works without AI using rule-based classification
- **PostgreSQL for Queue:** Eliminates need for separate Redis/RabbitMQ

---

## 5. TECH STACK

| Layer | Technology | Justification |
|-------|-----------|---------------|
| **Frontend** | React 18 + Vite | Fast HMR, modern hooks, excellent TypeScript support |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first, consistent design system |
| **Backend** | Node.js + Express | Event-driven, perfect for I/O-heavy monitoring workloads |
| **Database** | PostgreSQL 15 | ACID compliance, JSONB support, full-text search |
| **AI/LLM** | Ollama + Mistral | Local inference, privacy, no API costs |
| **Queue** | PostgreSQL (skip-locked) | No additional infrastructure, transactional consistency |
| **Testing** | Vitest | Fast unit tests, native ESM support |
| **Version Control** | Git + GitHub | Industry standard, collaboration features |

**Alternatives Considered:**
- *MongoDB* → Rejected: ACID transactions critical for incident consistency
- *Redis for Queue* → Rejected: PostgreSQL skip-locking sufficient, less infrastructure
- *OpenAI API* → Rejected: Local LLM preserves data privacy, zero ongoing costs

---

## 6. TEAM ROLES

*To be filled by team members*

---

## 7. AI USAGE DECLARATION

| Module | Method | AI Tool | Notes |
|--------|--------|---------|-------|
| `server/slm.mjs` | Mixed | Cascade (Windsurf) | AI generated prompts and fallback logic; manual review and testing |
| `server/data.mjs` | AI-Assisted | Cascade | Job queue pattern and SQL queries generated; architecture designed manually |
| `README.md` | AI-Generated | Cascade | Documentation written by AI based on codebase analysis |
| UI Components | Manual | N/A | shadcn/ui registry components used as-is |
| Project Structure | Manual | N/A | Based on team decisions and requirements |

**Transparency Statement:**
AI tools (specifically Cascade in Windsurf IDE) were used extensively for:
- Code generation and scaffolding
- Prompt engineering for LLM integration
- Documentation and explanation generation
- Debugging and error resolution

All AI-generated code was reviewed, tested, and modified by team members to ensure correctness and understanding.

---

## 8. PROMPTS

### Prompt 1: Project Understanding
- **Tool:** Cascade (Windsurf)
- **Prompt:** "Explain what this Auto-Ops Sentinel project does, how it works, and what types of problems it solves"
- **Purpose:** Understand the codebase architecture for viva preparation
- **Outcome:** Used - provided comprehensive system overview

### Prompt 2: Chat Analyst Improvement
- **Tool:** Cascade
- **Prompt:** "The Chat Analyst response is too verbose and unstructured. Make it identify problems and suggest exact fixes in a clean format"
- **Purpose:** Improve AI response structure for better usability
- **Outcome:** Used - implemented structured response format with sections for Problem, Root Cause, Impact, Fixes

### Prompt 3: Docker Setup
- **Tool:** Cascade
- **Prompt:** "Make docker to this project - add Dockerfile and docker-compose.yml with PostgreSQL"
- **Purpose:** Containerize the application for easy deployment
- **Outcome:** Used initially, later removed for simpler setup

### Prompt 4: SLM Performance Optimization
- **Tool:** Cascade
- **Prompt:** "The SLM part is slow and output format is not good. Improve the input/output of slm to be fast"
- **Purpose:** Optimize LLM prompt and response handling
- **Outcome:** Used - reduced context size, added caching, improved JSON schema

### Prompt 5: Monitor Analysis Bug Fix
- **Tool:** Cascade
- **Prompt:** "Two monitors exist but only one has SLM analysis. Why and how to fix?"
- **Purpose:** Debug and fix analysis triggering logic
- **Outcome:** Used - added healthy monitor analysis trigger in data.mjs

### Prompt 6: Code Cleanup
- **Tool:** Cascade
- **Prompt:** "Clean the project - remove dockers and not required things without affecting the running project"
- **Purpose:** Remove unnecessary files before submission
- **Outcome:** Used - removed Dockerfile, docker-compose.yml, log files

### Prompt 7: Connect Qwen/Mistral Model
- **Tool:** Cascade
- **Prompt:** "I have Qwen model, how can I connect it to the SLM?"
- **Purpose:** Configure local LLM integration
- **Outcome:** Used - configured Mistral model via Ollama

### Prompt 8: Concurrency Configuration
- **Tool:** Cascade (informational)
- **Prompt:** "Where can I change the number of parallel monitor checks?"
- **Purpose:** Find configuration for scalability tuning
- **Outcome:** Used - identified CHECK_WORKER_CONCURRENCY in data.mjs

---

## 9. MILESTONES & TIMELINE

| Release | Dates | Deliverables | Assigned |
|---------|-------|--------------|----------|
| **Release 1** | Mar 10-17 | Problem statement, architecture, basic monitoring, AI integration, documentation | All members |
| **Release 2** | Mar 18-31 | Notification channels, status pages, advanced analytics, performance testing | TBD |
| **Final Submission** | Apr 1-7 | Complete feature set, comprehensive testing, demo video | All members |

**Release 1 Completed:**
- ✅ Multi-protocol monitoring (10 types)
- ✅ Job queue with concurrent workers
- ✅ Incident lifecycle management
- ✅ AI-powered Signal Analyst
- ✅ Chat Analyst interface
- ✅ PostgreSQL persistence
- ✅ Real-time dashboard

---

## 10. GOALS FOR RELEASE 2

**Specific Deliverables:**

1. **Notification System (Mar 20)**
   - Slack integration via webhooks
   - Email alerts via SMTP
   - PagerDuty/OpsGenie integration
   - Configurable notification policies per monitor

2. **Public Status Pages (Mar 23)**
   - Read-only status page for external users
   - Incident history with RSS feed
   - Custom branding support
   - Badge/shield generation for README files

3. **Advanced Analytics (Mar 27)**
   - Uptime percentage calculations (24h, 7d, 30d)
   - Latency trend graphs
   - Error rate heatmaps
   - MTTR (Mean Time To Resolution) tracking

4. **Performance Optimization (Mar 30)**
   - Benchmark: Handle 100+ monitors with < 5s check latency
   - Connection pooling for database
   - Response body compression
   - Redis caching layer for frequent queries

5. **Testing & Documentation (Mar 31)**
   - 80%+ unit test coverage
   - Integration tests for all check types
   - API documentation (OpenAPI/Swagger)
   - User guide with screenshots

**Known Challenges & Mitigation:**
- **Challenge:** Concurrent job processing at scale
  - **Mitigation:** Implement Redis for distributed queue if needed
- **Challenge:** LLM response consistency
  - **Mitigation:** Fine-tune prompts, add response validation
- **Challenge:** Database performance with large check history
  - **Mitigation:** Implement retention policies and archival

---

## 11. SUBMISSION CHECKLIST

- ✅ Problem Statement - specific, validated, user-focused
- ✅ Proposed Solution - clear, novel, addresses the problem
- ✅ System Architecture - diagram + component descriptions
- ✅ Tech Stack - all technologies listed with justification
- ⬜ Team Roles - *to be completed by team*
- ✅ AI Usage Declaration - all AI usage documented
- ✅ Prompts - full log of all AI prompts
- ✅ Milestones & Timeline - complete across all releases
- ✅ Goals for Release 2 - specific, measurable commitments

---

*Document generated on: March 17, 2026*
*Project: Auto-Ops Sentinel*
*Repository: https://github.com/Hemanth-SVS/AI_API_MONITOR*
