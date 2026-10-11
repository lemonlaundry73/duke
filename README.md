# Duke Forge 3.0: build the open-world game you dream about

Duke Forge is a paid web platform that walks a first-time creator through **67 gated steps**, the way studios make games: from one paragraph about their idea to a released, high-definition Unreal Engine 5 game. Characters are built with Character Creator 5, Headshot 3 and Blender, the world with PCG and AI agents, and AI does the slow parts at every step. The creator makes every decision and plays every role.

## Two modes, same steps
- **Build mode.** Each step is a gate. The next step opens only when its checks pass:
  - **Verified by Duke:** the build agent on the creator's PC reports GPU, VRAM, RAM, Unreal, Visual Studio, Character Creator 5, Blender, Git and LFS. It reads their `.uproject` (enabled plugins, content folders, Git and LFS), syncs the design into `Content/DukeForge/design.json`, and packages builds.
  - **Proof:** private uploads such as screenshots and clips.
  - **Answers:** fields with validation rules.
  - **Self-checks:** things only a human can judge.
  - Completion is sticky: turning the PC off never relocks finished work.
- **Course mode** (Academy and above). Every step becomes a lesson with **Learn, Watch, Do and Check** parts on the creator's own game. Each phase ends in a quiz, and passing it earns a public, verifiable certificate at `/certificate/:id`. Lesson videos are optional: put `{"<step-slug>":"https://…"}` in `DATA_DIR/course-media.json`.

Both modes explain every term in plain words. Terms are underlined; tap one to see its definition. There are 124 glossary entries.

## Duke Link: your tools, live inside Duke
Creators never have to leave Duke once their tools are installed:
- **Tool cards:** Unreal Engine 5, Character Creator 5, Blender and Visual Studio each show whether they're installed or open, with an **Open** button. The agent launches them on the creator's PC, and Unreal opens with their project.
- **Live view:** the agent streams the chosen tool window into Duke (Pillow screen capture as JPEG, relayed as MJPEG at about 6–8 fps).
- **Use it here:** the creator's clicks, scrolls and keys go back to that window. The first time, the PC itself asks the creator to allow it. Only tool windows are ever listed or streamed.
- **Snap for proof:** one tap saves the live picture as the current step's proof, privately.
- **One-tap actions**, explained in plain words:
  - turn on Unreal remote control
  - enable the plugins (step 12) and make the 7 folders (step 13)
  - turn on Git and LFS, and save snapshots
  - save all, play and stop
  - drop a gray test room for the blockout (step 15)
- **How Unreal actions run:** through Unreal's own Python remote execution in the open editor, or by editing project files while the editor is closed.
- **Limits:** it is not a full remote desktop. Picture quality and latency depend on the creator's upload speed. The tools must be installed on the creator's PC; Duke cannot host Unreal or Character Creator in the cloud, because of their licenses and GPU needs.

## The 9 phases
| Phase | Steps |
|---|---|
| Plan | 1–8 (free) |
| Set up | 9–14 |
| Prototype | 15–22 |
| Characters (CC5, Headshot 3, Blender) | 23–33 |
| World from scratch | 34–44 |
| Living population | 45–52 |
| Audio | 53–57 |
| Vertical slice and AI expansion loop | 58–63 |
| Performance and release | 64–67 |

The content lives in `src/roadmap.js`, `src/glossary.js` and `src/course.js`.

## The expansion loop (Studio plan)
1. The creator sets numeric requirements: districts, interiors, NPC looks, species, languages, activities and fps.
2. Duke picks the biggest gap and drafts a pass plan with Claude or OpenAI, or with templates when neither is set.
3. The creator builds the pass in Unreal's Sandbox.
4. The creator reports what was added and the measured fps, and uploads after-screenshots.
5. Automatic checks run: something was added, fps is at or above target, and screenshots are attached.
6. The creator reviews the pass and approves or rejects it. Approving merges it and updates the numbers.

Driving the Unreal editor itself through the MCP plugin is not automated yet. That part is done by the creator, or by their own MCP-connected assistant.

## Plans and billing
| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Phase 1, the director and the live preview; 1 game |
| Creator | $39/mo | All 67 steps, 300 3D credits a month and PC builds; 3 games |
| Academy | $69/mo | Creator plus Course mode, quizzes and certificates |
| Studio | $149/mo | Academy plus the expansion loop, cloud builds and 1,000 credits; 10 games |

Billing details:
- Yearly plans cost 10× the monthly price, so two months are free.
- The first paid plan includes a 7-day trial.
- 3D generations (Meshy) cost credits: concept 2, model 15, rig 5 and animations 5. Failed jobs are refunded.

Stripe setup, with no SDK. **Easiest:** set only `STRIPE_SECRET_KEY` and `SITE_URL`. On start, Duke creates its own products, monthly and yearly prices (lookup keys `duke_forge_<plan>_<interval>`), the webhook and a Customer Portal config, and stores what it made in `DATA_DIR/stripe.json`. It reuses them on every restart. **Manual alternative:**
- Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, plus six price IDs: `STRIPE_PRICE_{CREATOR,ACADEMY,STUDIO}_{MONTH,YEAR}`.
- Point a webhook at `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`.
- Enable the Customer Portal in Stripe.

For local testing, `BILLING_TEST_MODE=1` activates plans instantly. `ADMIN_EMAILS` gives listed accounts full access.

## Public site (SEO)
The site is server-rendered, with canonical URLs, Open Graph tags and JSON-LD:
- `/`: SoftwareApplication and FAQPage
- `/pricing`
- `/guide`, plus 67 `/guide/<step>` pages: HowTo and BreadcrumbList
- `/glossary`, plus 124 `/glossary/<term>` pages: DefinedTerm
- 7 search-intent pages under `/learn/…`, such as "how to make a game like GTA" and "Character Creator 5 beginner guide": FAQPage
- `/showcase`
- `/sitemap.xml` and `/robots.txt`

Set `SITE_URL` in production so canonical links are right.

## Run it
Node.js 22.2 or newer is all you need. There is no npm install.
```bash
cp .env.example .env
node server.js        # http://localhost:3000  → /signup → /studio
```
To deploy, use `render.yaml` (Docker with a persistent disk at `DATA_DIR`). Data is stored in a JSON file in `DATA_DIR`.

## Build machines
- **The creator's PC:** in step 9, the creator downloads `DukeSetup.cmd`. It installs Python, the VS 2022 C++ tools, the Epic Games Launcher and the per-user agent, which starts automatically.
- **What the agent does** (`public/agent/duke_agent.py`, standard library only):
  - reports hardware and tools
  - inspects and syncs the linked project
  - packages either the creator's own project or Duke's generated C++ starter project
  - uploads the build
  - can publish to itch.io with butler
- **Cloud builds (Studio):** run the agent on a Windows GPU server with `--token $CLOUD_AGENT_TOKEN`. It can only build Duke's generated projects.

## Security
- Passwords are hashed with scrypt.
- Sessions use HttpOnly SameSite cookies.
- Every project route checks ownership.
- Proof uploads, including creators' face photos, are served only to their owner.
- Agent tokens are per user.
- Stripe webhooks are verified with HMAC and processed idempotently.
