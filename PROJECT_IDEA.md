# AI Workplace

## Product

Businesses hire specialized AI workers by the hour from a marketplace and manage their own team in a top-down virtual office. The product can serve many professions, including software engineering. Warehouse inspection and procurement are the first demonstration. The office shows only the workers hired by that workspace. A large catalog is the longer-term vision.

## Customer journey

1. The user gives the Dispatcher a request. It identifies the skills needed and checks the current team's capabilities.
2. A qualified worker receives the task. If the team lacks a skill, the Dispatcher keeps the original task and drafts a job posting. The user can also open the marketplace independently.
3. The posting asks for the desired deliverable, allowed sources or tools, and what needs approval. The marketplace shows candidate skills, qualifications or sample work, permissions and hourly rate.
4. The user chooses a worker. Hiring adds the worker to the office and hands it the original task without re-entry. Later requests can use the same hire.
5. Workers return reports to the team. The user sees evidence, runtime, demo cost and any follow-up action.

## Office and marketplace

Use original top-down office artwork, clickable stations and a detail panel. Select reception to submit a request, a desk to inspect work, and a vacant desk to enter the marketplace. Show a new hire arriving at the desk. Animate departure on job acceptance and return on receipt of a real report. Keep the result accessible in task history. Present the startup through the customer problem and working product.

## First live workflow

A missing component creates a replacement request. A catalog assistant can search internal records. A Procurement Researcher can check live supplier websites using TinyFish. For the first milestone verify one supplier lookup. Later compare two sources and show the observations side by side. The worker produces a sourcing brief for the operator to review.

## Hardware demonstration

The Mac hosts the office and task service. The planned Quality Inspector runs on a Raspberry Pi with QNX, using a Logitech C270 and a qualifying open-source AI module from https://oss.qnx.com. Pair the board as Packing Station 1. A local Ethernet link can carry tasks and reports, while the Mac uses Wi-Fi for online research. The inspection model runs on the Pi. Its avatar represents its status in the office.

The judge removes a part from a tray. The Pi reports ready, missing part, or inspection needed when uncertain. Demonstrate offline inspection locally and deliver a pending report when the connection returns. The Dispatcher offers a procurement follow-up. During software development, a clearly labeled simulated inspection can exercise the same reporting path.

Reported hardware in hand includes a Pi in a cooled enclosure, C270, 32 GB microSD, power adapter and micro-HDMI cable. Confirm QNX boot image, camera operation, eligible module, and wired connectivity on actual hardware.

## Engineering and demo pricing

Use a persistent task ID across routing, hiring, execution and reporting. Suggested states are needs_worker, queued, working, completed and failed. Store the workspace hire separately from the marketplace profile. Later persist hires, tasks, runs, rate snapshots and source-linked results. Repeated hire clicks or duplicate station reports should produce a single assignment and charge.

Proposed demo pricing bills active run time by the second. At $6/hour a 90-second job costs $0.15. Keep demo customer charges distinct from actual provider costs. Confirm pricing and failure policy before real billing.

## Build sequence

1. One verified live TinyFish supplier lookup.
2. Dispatcher, skill gap, job posting, marketplace hire and automatic handoff of the original request.
3. Interactive office, saved reports and demo metering.
4. Live Pi inspection and report delivery through the same workflow.
5. Rehearse the judge-controlled inspection, hire and follow-up. Confirm current submission requirements for TinyFish and QNX on the event page.

Event: https://hack-western-13.devpost.com/
