/**
 * Detailed example briefs for the AI architecture chat — realistic, fully
 * specified requests that exercise the whole guided flow (analysis → build →
 * cost questions → priced options) and showcase concrete AWS + Atlas services
 * plus explicit AI use cases in every scenario. Clicking one pre-fills the
 * composer so the text can be edited before sending.
 *
 * Keep each prompt under ~8k characters — the chat API accepts up to 10k
 * (schemas.ts chatMessageSchema) and users edit these upward.
 */

export interface ExamplePrompt {
  id: string;
  title: string;
  tagline: string;
  /** short service tags shown on the card */
  services: string[];
  prompt: string;
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    id: 'iot-telemetry',
    title: 'IoT fleet telemetry + anomaly detection',
    tagline: 'MQTT ingestion, streaming pipeline, time-series storage, AI-driven alerting',
    services: ['IoT Core', 'Kinesis', 'Lambda', 'Atlas', 'SageMaker', 'Bedrock'],
    prompt: `Design an AWS + MongoDB Atlas architecture for an industrial IoT monitoring platform used by a manufacturing group to watch the health of machines across 12 factories.

GOAL: detect failing machines before they break, cut unplanned downtime by 30%, and give plant operators a live dashboard with alert history and root-cause context.

USERS & SCALE: 10,000 sensors today (temperature, vibration, pressure, power draw), growing to 50,000 within 18 months. Each sensor publishes a ~1 KB JSON reading every 10 seconds (~1,000 msg/s today, ~5,000 msg/s at target scale). Around 200 operations staff use the dashboard; 15 reliability engineers run deeper analyses.

REGION & AVAILABILITY: us-east-1, spread across at least 2 availability zones. Ingestion must tolerate a single-AZ failure without losing messages; the dashboard can degrade gracefully.

INGESTION FLOW: devices authenticate with per-device X.509 certificates and publish over MQTT to AWS IoT Core. IoT rules route every reading into Kinesis Data Streams (provisioned shards sized for peak). A Lambda consumer validates schema, enriches readings with machine metadata, discards duplicates, and writes clean time-series documents to MongoDB Atlas (M30, 3-node replica set). Malformed messages go to a dead-letter SQS queue for inspection. Raw payloads are also batched to S3 (partitioned by factory/day) as the permanent archive, queryable ad hoc with Athena.

APPLICATION LAYER: a REST API on API Gateway + Lambda serves the operator dashboard: latest readings per machine, alert history, acknowledgement workflow, and fleet-level KPIs. Authenticate operators with Cognito (per-factory groups controlling which plants each user sees). Device credentials, API keys, and the Atlas connection string live in Secrets Manager, encrypted with KMS.

DATA & STORAGE: Atlas holds 90 days of hot time-series data plus machine metadata and alert documents; use Atlas Search for free-text search over alert notes. S3 + Athena covers anything older. Plan data lifecycle rules so S3 storage classes downgrade after 6 months.

AI USE CASES:
1) Anomaly detection — a SageMaker model scores vibration + temperature patterns per machine class, retrained weekly from the S3 archive via a Step Functions pipeline on an EventBridge schedule. Scores above threshold create alert documents in Atlas and notify on-call via SNS.
2) Incident summaries — when an alert fires, Amazon Bedrock composes a plain-English summary (what deviated, since when, similar past incidents pulled from Atlas) that is attached to the alert and sent in the SNS notification.
3) Maintenance assistant — a small chat endpoint lets engineers ask "why did press #4 alert last night?"; the backend retrieves the relevant readings and past incidents from Atlas and answers via Bedrock with citations.

OPERATIONS & MONITORING: CloudWatch dashboards for ingestion lag, shard utilization, Lambda errors, and API latency; alarms page the on-call channel through SNS. CloudTrail enabled account-wide. X-Ray tracing on the API path.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery; S3 versioning on the archive bucket; infrastructure state backed by AWS Backup where applicable. Document the recovery steps for a full-region outage (best effort, no active-active requirement).

BUDGET & COST: target under $800/month at today's scale. Please show me both the cheapest viable configuration and the best-practice configuration with the cost difference itemized per service, and call out which line items grow linearly with sensor count.`,
  },
  {
    id: 'ecommerce-ai',
    title: 'E-commerce platform with AI recommendations',
    tagline: 'Global storefront, microservices, semantic product search, peak-sale resilience',
    services: ['CloudFront', 'ECS', 'Atlas Search', 'Vector Search', 'ElastiCache', 'SQS'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a mid-size fashion e-commerce platform replacing a monolithic on-prem shop.

GOAL: a resilient storefront that survives seasonal sale spikes without over-provisioning year-round, with AI-powered product discovery that lifts conversion.

USERS & SCALE: 100,000 monthly active shoppers, ~2,000 concurrent sessions at normal peak, 5x spikes during seasonal sales (Black Friday plan: 10,000 concurrent). Catalog of 80,000 SKUs with ~1,200 updates/day from the merchandising team. 30 back-office staff.

REGION & AVAILABILITY: primary region eu-west-1, multi-AZ everywhere; static assets and images served globally. Checkout must stay available if one AZ fails.

DELIVERY & EDGE: Route 53 DNS, CloudFront in front of everything, WAF with bot-control and rate-limiting rules protecting the API. Product images and static frontend assets in S3 behind CloudFront. TLS certificates from Certificate Manager.

APPLICATION SERVICES: containerized microservices on ECS Fargate behind an Application Load Balancer — catalog, cart, checkout, orders, customer-account services as separate task groups so they scale independently (cart and checkout scale hardest during sales). Shopping-cart and session state in ElastiCache Redis with a write-through to Atlas so carts survive cache eviction.

ORDER PIPELINE: checkout publishes an order-created event to SQS; a fulfillment worker service consumes it, reserves stock, captures payment through the PSP, and writes the order document. SES sends confirmation and shipping emails. Failed payments land in a dead-letter queue with an operator replay tool.

DATA & STORAGE: MongoDB Atlas cluster (M30, 3 nodes) holds products, customers, orders, and inventory. Keyword + faceted search with Atlas Search (brand, size, color facets). Media originals in S3 with lifecycle rules.

AI USE CASES:
1) Semantic search — "warm jacket for rainy city commutes" style queries answered via Atlas Vector Search over product embeddings generated with Amazon Bedrock; embeddings refresh nightly through an EventBridge-scheduled Lambda that re-embeds changed SKUs only.
2) Recommendations — "similar products" and "complete the look" panels driven by vector similarity plus purchase-history signals; scores cached in ElastiCache with a 24h TTL.
3) Product-copy assistant — merchandisers can generate first-draft product descriptions from attributes via a Bedrock-backed internal endpoint (rate-limited, audit-logged).

SECURITY & COMPLIANCE: Cognito for customer identity (social login + email), KMS encryption at rest for all stores, Secrets Manager for PSP keys, strict egress rules on VPC subnets, GuardDuty enabled, CloudTrail for audit. PCI scope minimized by tokenizing cards at the PSP — no PAN storage anywhere.

OPERATIONS & MONITORING: CloudWatch golden-signal dashboards per service, alarms on p95 latency, error rate, queue depth, and cache hit ratio; X-Ray tracing across the checkout path. Load-test plan before each sale event.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery, S3 versioning, AWS Backup for supporting resources. RPO 15 minutes, RTO 4 hours.

BUDGET & COST: compare a cost-optimized configuration (smaller steady-state, aggressive autoscaling) against best practice, itemized per service. Flag the three most expensive line items and cheaper alternatives for each.`,
  },
  {
    id: 'rag-assistant',
    title: 'RAG knowledge assistant (AI-first)',
    tagline: 'Document ingestion, embeddings, vector retrieval, LLM chat backend',
    services: ['Bedrock', 'Vector Search', 'Step Functions', 'API Gateway', 'Cognito'],
    prompt: `Design an AWS + MongoDB Atlas architecture for an internal AI knowledge assistant that answers employee questions from company documents (retrieval-augmented generation), replacing a wiki nobody searches.

GOAL: grounded, cited answers over the company's policy documents, engineering runbooks, HR handbook, and past project reports — with a clear ingestion path the knowledge team can operate without engineers.

USERS & SCALE: 500 employees with SSO, ~50 concurrent chats at lunchtime peak, target answer latency under 3 seconds p95 end-to-end. Corpus: 20,000 documents today (PDF, Word, HTML exports), growing ~500/month; average 15 pages per document.

REGION & AVAILABILITY: us-east-1, multi-AZ for the serving path. The ingestion pipeline may be single-AZ (it is retryable batch work).

INGESTION PIPELINE: the knowledge team drops files into an S3 bucket (one prefix per source system). An EventBridge rule triggers a Step Functions workflow per file: a Lambda extracts text (with OCR fallback), a second Lambda chunks it (~800 tokens with overlap) and attaches metadata (source, owner, effective date, access tier), a third calls Amazon Bedrock to embed each chunk, and a final step upserts chunks + embeddings + metadata into MongoDB Atlas with a Vector Search index. Failures land in a dead-letter queue with an operator re-drive; a nightly EventBridge job re-indexes documents whose source changed.

SERVING PATH: a REST API on API Gateway + Lambda handles each chat turn: embed the question (Bedrock), run hybrid retrieval — Atlas Vector Search for semantic hits plus Atlas Search keyword matching — apply the user's access tier as a metadata filter, then call a Bedrock foundation model with the retrieved chunks to compose an answer with inline citations back to the source documents. Conversation history and feedback (thumbs up/down with comment) persist in the same Atlas cluster.

ACCESS CONTROL: Cognito federated to the corporate IdP (SAML). Access tiers (public / internal / restricted) enforced at retrieval time via metadata filters — restricted chunks never reach the model context for unauthorized users. Admin console for the knowledge team to manage sources and view ingestion status.

AI USE CASES (this system IS the AI use case, but be explicit):
1) Grounded Q&A with citations as described above.
2) Answer-quality loop — weekly Step Functions job samples low-rated answers, uses Bedrock to classify the failure (bad retrieval vs. missing document vs. bad synthesis), and files a report to the knowledge team via SES.
3) Document summaries — on ingestion, generate a 5-line abstract per document (Bedrock) stored alongside metadata to speed up retrieval ranking and the admin console.

SECURITY & OPERATIONS: KMS encryption at rest everywhere, Secrets Manager for credentials, X-Ray tracing across the serving path, CloudWatch dashboards for retrieval latency, token usage, and pipeline throughput, GuardDuty on the account, CloudTrail audit. Guardrail: log every prompt/response pair to S3 (restricted bucket) for audit, 90-day retention.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery; S3 versioning on the corpus bucket (the corpus is re-ingestable, so RTO 1 day is acceptable for the index, but conversation history RPO 15 minutes).

BUDGET & COST: this starts as a pilot — show the cheapest viable configuration for the pilot AND what production best practice costs, with the per-service delta explained. Call out which costs scale with corpus size versus with chat volume.`,
  },
  {
    id: 'clickstream-analytics',
    title: 'Real-time clickstream analytics platform',
    tagline: 'Event streaming, S3 data lake, warehouse + BI, ML churn prediction',
    services: ['Kinesis', 'Glue', 'Athena', 'Redshift', 'OpenSearch', 'SageMaker'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a product-analytics data platform processing web and mobile clickstream events for a consumer app company.

GOAL: one governed data platform that powers analyst SQL, executive BI dashboards, near-real-time product monitoring, and ML features — replacing three disconnected tools.

USERS & SCALE: 50 million events/day (~600/s sustained, 3,000/s peak during campaigns), 30 analysts running SQL daily, 8 BI dashboards refreshed hourly, 5 data engineers operating the platform. The raw lake must retain 13 months of history (~4 TB/year compressed).

REGION & AVAILABILITY: us-east-1. The ingestion path must be multi-AZ and lossless; analytics layers can tolerate brief maintenance windows.

INGESTION & LAKE: client SDKs send batched events to an API Gateway endpoint that forwards to Kinesis Data Streams. A Lambda consumer validates against a versioned event schema, rejects malformed events to a dead-letter queue, and batches valid ones into an S3 data lake as compressed columnar files partitioned by event date and type. AWS Glue crawls the lake, maintains the data catalog, and runs nightly ETL that compacts small files and builds curated, deduplicated tables.

ANALYTICS LAYERS:
- Athena for ad-hoc SQL directly on the lake (analysts; pay-per-query).
- Redshift (2 nodes to start) as the curated warehouse: sessionized tables, funnels, retention cohorts — powering the BI dashboards.
- OpenSearch ingests the last 24 hours of events for near-real-time product dashboards (feature launches, error spikes) with sub-minute freshness.

SERVING LAYER: aggregated metrics that the customer-facing product needs (per-account usage, funnel status) are written back to a MongoDB Atlas cluster; the product API reads them via API Gateway + Lambda so the analytics stack is never in the request path of the product.

AI USE CASES:
1) Churn prediction — weekly SageMaker training job orchestrated by Step Functions on an EventBridge schedule, trained from the curated Redshift/lake tables; per-user churn scores land in Atlas, and the lifecycle team triggers win-back email campaigns through SES for high-risk cohorts.
2) Anomaly narration — when OpenSearch alerting detects a metric anomaly (signup drop, error spike), a Lambda gathers the surrounding context and Amazon Bedrock writes a short incident note ("signups from paid search dropped 40% starting 14:05, coinciding with…") posted to the team channel via SNS.
3) Natural-language querying (stretch goal) — an internal endpoint where an analyst types a question and Bedrock drafts the corresponding Athena SQL against the Glue catalog, returned for review before execution — never auto-executed.

GOVERNANCE, SECURITY & OPERATIONS: schema registry for events with versioning; Glue catalog as the single source of table truth. KMS encryption on S3, Redshift, and OpenSearch; IAM roles per team; CloudTrail audit; GuardDuty. CloudWatch alarms on ingestion lag, DLQ depth, Glue job failures, and Redshift disk usage.

BACKUP & DR: S3 versioning + lifecycle to infrequent access after 90 days; Redshift automated snapshots; Atlas Cloud Backup. The lake is the recovery source of truth — document rebuild runbooks for the warehouse and OpenSearch.

BUDGET & COST: optimize the ingestion path for cost (it runs 24/7) but the warehouse for reliability. Show cheapest vs. best practice with the trade-offs named per layer, and estimate how cost scales if events double.`,
  },
  {
    id: 'saas-platform',
    title: 'Multi-tenant B2B SaaS with an AI report copilot',
    tagline: 'Tenant isolation, async jobs, audit & backups, LLM-generated reports',
    services: ['ALB', 'ECS', 'Atlas', 'SQS', 'Bedrock', 'AWS Backup'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a multi-tenant B2B SaaS product — project and resource management for creative agencies.

GOAL: a trustworthy multi-tenant platform with clean tenant isolation, enterprise-grade auth, reliable background processing, and an AI reporting layer that differentiates the product.

USERS & SCALE: 200 tenant companies, 5,000 daily active users total; the largest tenant has 400 users, the median 15. Usage is business-hours-heavy across EU timezones. Growth plan: 500 tenants in 2 years.

REGION & AVAILABILITY: eu-west-1, multi-AZ, 99.9% availability target. GDPR-conscious: EU data residency, right-to-erasure support, and a documented data map.

DELIVERY & APP: web app static assets in S3 behind CloudFront with Route 53 and WAF. The REST API runs as ECS Fargate services behind an Application Load Balancer, split into: core API, reporting service, and webhook/integration service — scaled independently. Authenticate with Cognito; enterprise tenants get SAML SSO with per-tenant IdP configuration.

DATA & ISOLATION: MongoDB Atlas cluster (M30, 3-node replica set) with per-tenant logical isolation — every document carries a tenantId enforced by a repository layer; indexes are compound with tenantId first. Full-text search across projects, tasks, and comments via Atlas Search (tenant-filtered). Hot per-tenant configuration cached in ElastiCache. File attachments in S3 with per-tenant prefixes and presigned-URL access only.

ASYNC WORK: long-running exports/imports and integration syncs flow through SQS to worker Lambdas with per-queue DLQs; scheduled jobs (invoicing, weekly digests, data-retention sweeps) run on EventBridge schedules; transactional email through SES with per-tenant sending identities.

AI USE CASES:
1) AI report copilot — a monthly Step Functions workflow per tenant aggregates utilization, project margins, and deadline slippage, asks Amazon Bedrock to write a narrative performance summary with recommendations, renders it to PDF, stores it in S3, and emails it via SES. Tenants can regenerate on demand with custom focus areas.
2) "Summarize this project" — an in-app action that feeds the project's tasks, comments, and status history to Bedrock and returns a stakeholder-ready summary; responses cached in Atlas keyed by project version.
3) Smart staffing suggestions — vector similarity over past-project profiles (Atlas Vector Search with Bedrock embeddings) to suggest which team fits a new brief.

SECURITY & COMPLIANCE: KMS encryption at rest, Secrets Manager for third-party keys, CloudTrail organization-wide, GuardDuty, per-service IAM roles, quarterly access review export. Right-to-erasure: a Step Functions workflow that hard-deletes a tenant's documents, S3 objects, caches, and backups metadata trail.

OPERATIONS & MONITORING: CloudWatch dashboards per service, alarms on error rate, queue age, and per-tenant rate anomalies; X-Ray tracing on the API. Feature flags via app config in Atlas.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery (RPO 15 min), AWS Backup for supporting resources, S3 versioning. Restore runbook tested quarterly. RTO 4 hours.

BUDGET & COST: leadership wants both numbers — cheapest viable and best practice — itemized, plus which components step-change in cost as we grow from 200 to 500 tenants.`,
  },
  {
    id: 'video-streaming',
    title: 'Video-on-demand streaming & processing',
    tagline: 'Upload pipeline, transcoding workers, global delivery, AI captions & summaries',
    services: ['S3', 'Batch', 'CloudFront', 'ECS', 'Bedrock', 'Atlas'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a video-on-demand platform where creators upload training courses and viewers stream them worldwide.

GOAL: a reliable upload → process → publish pipeline and smooth global playback, with AI features (captions, chapters, summaries) generated automatically for every video.

USERS & SCALE: 2,000 creators uploading ~500 videos/day (average 20 minutes, 1080p); 150,000 registered viewers, ~3,000 concurrent streams at evening peak. Library: 120,000 videos (~200 TB of renditions). Viewers worldwide; creators mostly EU/US.

REGION & AVAILABILITY: processing in us-east-1; playback must be global via CDN. Upload and playback must survive an AZ failure; the processing queue may delay during incidents but never lose jobs.

UPLOAD & PROCESSING PIPELINE: creators upload via presigned multipart URLs directly to an S3 "masters" bucket. An EventBridge rule fires a Step Functions workflow per upload: probe the file (Lambda), fan out transcoding jobs to AWS Batch on Fargate (renditions: 1080p/720p/480p HLS), generate thumbnails, run content checks, then write rendition manifests to the "delivery" S3 bucket and mark the video ready. Failed jobs retry with backoff and land in a DLQ with operator tooling.

DELIVERY & PLAYBACK: HLS segments served from the delivery bucket through CloudFront with signed URLs (viewers must be entitled); Route 53 DNS; WAF in front of the API. Player analytics events (play, pause, completion, rebuffering) flow through Kinesis into S3 for analysis with Athena.

APPLICATION LAYER: the catalog/API service on ECS Fargate behind an ALB: course catalog, entitlements, watch progress, creator studio. Cognito for both audiences (viewer accounts + creator accounts with different groups). Watch progress and entitlements in MongoDB Atlas (M30); catalog search with Atlas Search (title, topic, transcript text).

AI USE CASES:
1) Auto-captions & transcripts — a transcription step in the processing workflow produces per-video transcripts stored in Atlas; transcripts are searchable via Atlas Search so viewers can jump to the exact minute a phrase is spoken.
2) Chapters & summaries — Amazon Bedrock segments each transcript into titled chapters and writes a course summary + key takeaways shown on the video page.
3) Semantic discovery — Bedrock embeddings of transcripts + descriptions in Atlas Vector Search power "viewers who liked this also learned…" recommendations and natural-language search ("intro to pricing strategy for freelancers").
4) Moderation assist — new uploads get a Bedrock screening pass over transcript text; flagged items queue for human review before publish.

SECURITY & OPERATIONS: KMS on all buckets, Secrets Manager, per-service IAM, GuardDuty, CloudTrail. CloudWatch dashboards for pipeline throughput, Batch queue depth, CDN error rates, and rebuffer ratio; alarms to SNS.

BACKUP & DR: masters bucket versioned + lifecycle to archive tier after 30 days (renditions are re-derivable); Atlas Cloud Backup point-in-time. Document a rebuild runbook for the delivery bucket.

BUDGET & COST: storage and egress dominate — show cheapest vs. best practice, the estimated CDN egress line separately, and which knobs (rendition ladder, archive tiering) move cost the most.`,
  },
  {
    id: 'fintech-payments',
    title: 'Payments processing & ledger (fintech)',
    tagline: 'Idempotent payment flows, immutable ledger, fraud scoring, strict compliance',
    services: ['API Gateway', 'Lambda', 'SQS', 'Atlas', 'SageMaker', 'KMS'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a payments platform that processes card and bank-transfer payments for online merchants, with an auditable double-entry ledger.

GOAL: correctness above all — no double charges, no lost money movements, a ledger auditors trust — plus real-time fraud screening on every transaction.

USERS & SCALE: 800 merchants, 1.2 million transactions/month (~30/s peak), average basket €45. 40 back-office staff (support, risk, finance). Strict SLAs: authorize within 2 seconds p95.

REGION & AVAILABILITY: eu-west-1, multi-AZ mandatory on the entire authorization path; 99.95% availability target for the payment API.

PAYMENT FLOW: merchants call a REST API (API Gateway + Lambda) with idempotency keys. The authorization Lambda validates, runs the fraud check (see AI below), calls the acquiring PSP, and writes an immutable transaction event. Every state change is an append-only event; the double-entry ledger is derived from events, never edited. Asynchronous steps (settlement, refunds, chargebacks, webhooks to merchants) flow through SQS FIFO queues with per-merchant message groups to preserve ordering; DLQs with replay tooling on every queue. Webhooks are signed and retried with exponential backoff.

DATA & LEDGER: MongoDB Atlas (M30, 3-node) holds transaction events, ledger projections, merchant accounts, and dispute cases. Ledger projections rebuild from events via a replay job — verify this in CI monthly. Atlas Search powers back-office case search. Never store PANs: card data is tokenized at the PSP; we keep tokens + last4 only.

AI USE CASES:
1) Real-time fraud scoring — a SageMaker real-time endpoint scores every authorization (velocity features from ElastiCache, merchant risk profile, amount/geo signals) within a 150 ms budget; scores route transactions to approve / challenge (3DS) / decline. The model retrains weekly via Step Functions from labeled outcomes.
2) Dispute assistant — Amazon Bedrock drafts chargeback representment packages from the transaction timeline and merchant evidence, cutting case handling time; drafts are always human-reviewed.
3) Anomaly watch — daily Bedrock-written digest of unusual merchant patterns (sudden volume spikes, refund-rate anomalies detected by scheduled Athena queries over the event archive in S3) sent to the risk team via SES.

SECURITY & COMPLIANCE: everything encrypted with customer-managed KMS keys; Secrets Manager with rotation for PSP credentials; strict least-privilege IAM; CloudTrail with log-file integrity validation; GuardDuty; WAF on all public endpoints; network isolation in private subnets, no public database access. Full audit trail: who saw what customer data, exportable for regulators.

OPERATIONS & MONITORING: CloudWatch dashboards for auth latency, approval rate, queue age, and PSP error rates; X-Ray on the authorization path; alarms page on-call via SNS. Synthetic canary transactions every minute.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery, RPO 5 minutes; event archive continuously exported to S3 (versioned, object-lock for immutability). RTO 2 hours with a documented, rehearsed runbook.

BUDGET & COST: reliability outweighs cost on the auth path, but show both a lean configuration and best practice; call out what the 99.95% target adds versus 99.9%.`,
  },
  {
    id: 'healthcare-portal',
    title: 'Healthcare patient portal (compliance-first)',
    tagline: 'PHI isolation, consent-aware access, telehealth booking, AI triage summaries',
    services: ['Cognito', 'ECS', 'Atlas', 'KMS', 'Bedrock', 'GuardDuty'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a patient portal for a network of 40 clinics: appointment booking, secure messaging with care teams, lab results, and prescription renewals.

GOAL: a compliance-first design (HIPAA-style controls) where protected health information (PHI) is encrypted, access-audited, and consent-aware — while still giving patients a modern, fast experience with helpful AI assistance that never makes clinical decisions.

USERS & SCALE: 250,000 registered patients, ~8,000 daily active; 1,200 clinicians and staff across 40 clinics. Peak load Monday mornings (~600 concurrent). Region us-east-1 with multi-AZ on every tier; 99.9% availability.

APPLICATION LAYER: web + mobile clients hit a REST API on ECS Fargate services behind an Application Load Balancer, fronted by CloudFront + WAF and Route 53. Separate services for: scheduling, messaging, results delivery, and admin — each with its own IAM role and database credentials. All service-to-service traffic stays inside private VPC subnets; no database is publicly reachable.

IDENTITY & CONSENT: patients authenticate with Cognito (MFA optional, encouraged); clinicians federate from the clinic IdP with mandatory MFA. Every data access passes a consent/authorization layer: patients see only their records; clinicians only patients under their care (relationship documents in Atlas). Every PHI read/write is written to an append-only audit log.

DATA & STORAGE: MongoDB Atlas (M30, 3-node) stores appointments, messages, care relationships, and result metadata — encrypted at rest, field-level encryption on the most sensitive fields. Lab PDFs and imaging summaries in S3 with KMS customer-managed keys and presigned, short-lived, audit-logged access. Atlas Search for staff-side patient lookup (name, DOB, MRN) with results filtered by care relationship.

MESSAGING & NOTIFICATIONS: secure messaging documents in Atlas; notification fan-out via SQS to delivery workers; email through SES contains NO PHI (only "you have a new message" with a login link); appointment reminders likewise.

AI USE CASES (assistive only, never diagnostic):
1) Message triage summaries — Amazon Bedrock summarizes incoming patient messages and suggests a routing category (prescription / scheduling / clinical question) so front-desk staff clear queues faster; suggestions are visibly labeled AI-generated and require human confirmation.
2) Visit-prep summaries — before an appointment, Bedrock assembles a one-page brief for the clinician from the patient's recent messages, appointments, and result metadata (retrieved via Atlas queries, consent-checked before inclusion).
3) Patient FAQ assistant — a strictly-scoped RAG chatbot over the clinic's own public content (opening hours, preparation instructions, insurance) using Atlas Vector Search + Bedrock; it must refuse anything resembling medical advice and hand off to messaging.

SECURITY & COMPLIANCE: KMS everywhere, Secrets Manager with rotation, GuardDuty, CloudTrail with integrity validation, VPC flow logs, quarterly access reviews from the audit log, data-retention and erasure workflows. Sign a BAA-equivalent posture: document which services hold PHI and which never do.

OPERATIONS: CloudWatch dashboards + alarms (latency, error rates, queue depth, failed logins), X-Ray tracing, synthetic login canary. Incident response runbook with PHI-breach escalation path.

BACKUP & DR: Atlas point-in-time recovery (RPO 15 min), S3 versioning, tested restores monthly, RTO 4 hours.

BUDGET & COST: compliance features are non-negotiable; still show cheapest-compliant versus best practice, and where the money goes.`,
  },
  {
    id: 'logistics-fleet',
    title: 'Logistics & delivery fleet tracking',
    tagline: 'GPS streaming, geospatial queries, live ETAs, AI route optimization',
    services: ['Kinesis', 'Lambda', 'Atlas', 'EventBridge', 'SageMaker', 'SNS'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a last-mile delivery platform coordinating a van fleet across 15 cities, with live tracking for customers and dispatch tooling for operations.

GOAL: accurate live vehicle positions, dependable delivery-status events, dispatcher tools with geospatial search, and AI-assisted routing and ETAs that beat static planning by a measurable margin.

USERS & SCALE: 1,800 vehicles, each sending a GPS ping (position, speed, heading, battery, door status) every 5 seconds while on shift (~360 events/s daytime peak). 90 dispatchers; 40,000 customer tracking-page views/day; 250,000 deliveries/month.

REGION & AVAILABILITY: eu-west-1, multi-AZ on ingestion and the tracking API. Dispatch tooling can tolerate brief degradation; position ingestion cannot.

TELEMETRY INGESTION: driver devices publish pings to Kinesis Data Streams via an authenticated API Gateway proxy. A Lambda consumer validates, deduplicates, snaps positions to roads, updates the vehicle's latest-position document, and appends to a per-shift position history in MongoDB Atlas. Older raw pings batch to S3 (Athena for historical analysis, 13-month retention).

GEOSPATIAL & DISPATCH: Atlas geospatial indexes power dispatcher queries: vehicles within a polygon, nearest available van to a pickup, corridor searches along a route. Dispatch state machine (assigned → picked up → en route → delivered / failed) is event-sourced; every transition publishes to EventBridge so downstream consumers (notifications, analytics, billing) stay decoupled.

CUSTOMER EXPERIENCE: the tracking API (API Gateway + Lambda) serves live position + ETA to customer tracking pages (short-poll with cache headers; ElastiCache absorbs hot deliveries). SNS/SES send "driver nearby" and delivery-confirmation notifications. Proof-of-delivery photos upload to S3 via presigned URLs and attach to the delivery document.

AI USE CASES:
1) Learned ETAs — a SageMaker regression model predicts arrival windows from live traffic patterns in the position history, stop dwell times, and driver behavior; retrained nightly via Step Functions; predictions cached per active delivery and pushed to tracking pages. Measure against the naive distance/speed baseline.
2) Route optimization — overnight batch (Step Functions + Lambda/Batch) builds next-day route plans per depot from order manifests; a SageMaker optimization model proposes stop sequences; dispatchers can override, and overrides feed back as training signal.
3) Exception narration — when a delivery goes off-plan (long dwell, route deviation, repeated failed attempts), Amazon Bedrock writes a concise dispatcher note from the event timeline ("Van 214 stationary 22 min at stop 8; two failed contact attempts…") so dispatchers triage at a glance.

SECURITY & OPERATIONS: Cognito for dispatcher/driver identity with role separation; KMS at rest; Secrets Manager; WAF on public APIs; GuardDuty; CloudTrail. CloudWatch dashboards: ingestion lag, ping loss per city, ETA error distribution, notification failures; alarms via SNS to on-call.

BACKUP & DR: Atlas Cloud Backup point-in-time (RPO 15 min); S3 versioned archive; delivery events replayable from the archive. RTO 4 hours for dispatch, 1 hour for customer tracking.

BUDGET & COST: show cheapest vs. best practice; call out ingestion versus serving costs separately and what doubling the fleet does to each.`,
  },
  {
    id: 'social-community',
    title: 'Social community app with AI moderation',
    tagline: 'Feeds & fan-out, media handling, notifications, AI moderation + ranking',
    services: ['ECS', 'ElastiCache', 'SQS', 'CloudFront', 'Bedrock', 'Atlas'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a special-interest social community app (think: hobbyist forums reimagined as a modern feed) with posts, comments, groups, and media.

GOAL: a snappy feed experience, safe community spaces via layered AI moderation, and notifications that pull people back without being spammy.

USERS & SCALE: 400,000 registered users, 60,000 daily active, ~1,500 concurrent at peak; 45,000 posts/day, 250,000 comments/day, 20,000 image uploads/day. Read-heavy: ~50 reads per write. Region us-east-1, multi-AZ; 99.9% availability.

CONTENT & FEED: API on ECS Fargate behind an ALB (services: content, feed, notifications, moderation). Posts, comments, groups, follows in MongoDB Atlas (M30). Feed strategy: fan-out-on-write through SQS for users with < 10k followers (precomputed feed entries in ElastiCache Redis, backed by Atlas), fan-out-on-read for the few large accounts. Media uploads via presigned URLs to S3, served through CloudFront with image resizing at the edge (Lambda). Full-text + tag search via Atlas Search.

NOTIFICATIONS: event-driven via EventBridge → SQS → notification workers; digest batching rules (never more than 1 push/hour per user) with per-user preferences in Atlas; email via SES, push via the mobile provider.

AI USE CASES:
1) Layered moderation — every new post/comment/image caption gets a fast Bedrock screening pass (toxicity, harassment, spam likelihood). Clear content publishes instantly; borderline content queues for human moderators with the model's reasoning attached; severe content is auto-hidden pending review. All decisions logged for appeal.
2) Feed ranking — a SageMaker ranking model re-orders candidate feed items per user (recency, affinity, predicted engagement) retrained daily from interaction logs archived in S3; cold-start users get popularity-based ranking. Ranking features cached in ElastiCache.
3) Community health digest — weekly Bedrock-written summary per group for its moderators: emerging topics, sentiment shift, escalation candidates — generated from that group's content via Atlas queries.
4) Semantic discovery — "groups you might like" via Atlas Vector Search over group descriptions + user interest embeddings (Bedrock).

SECURITY & TRUST: Cognito (social + email login), rate limiting and WAF rules against scraping and spam, KMS at rest, Secrets Manager, GuardDuty, CloudTrail. Block-list and user-report flows feed the moderation queue. GDPR data-export and erasure workflows (Step Functions).

OPERATIONS & MONITORING: CloudWatch dashboards per service (p95 latency, cache hit ratio, queue depth, moderation queue age); alarms via SNS; X-Ray tracing on the feed read path — it is the golden path.

BACKUP & DR: Atlas Cloud Backup point-in-time; S3 versioning on media; feed caches are rebuildable — document the rebuild runbook. RPO 15 minutes, RTO 4 hours.

BUDGET & COST: read path cost matters most — compare cheapest vs. best practice with the caching layer's savings quantified, and show what the moderation AI adds per 1,000 posts.`,
  },
  {
    id: 'gaming-backend',
    title: 'Multiplayer game backend & live-ops',
    tagline: 'Session services, leaderboards, telemetry, AI NPC dialogue + churn prediction',
    services: ['ECS', 'ElastiCache', 'Kinesis', 'Atlas', 'Bedrock', 'SageMaker'],
    prompt: `Design an AWS + MongoDB Atlas architecture for the online backend of a session-based multiplayer game (mobile + PC): accounts, matchmaking, leaderboards, player inventory, telemetry, and live-ops tooling.

GOAL: low-latency player-facing services, robust telemetry for balancing, and AI-driven live-ops (dynamic NPC dialogue, churn prediction, content recommendations) — without exceeding the studio's budget.

USERS & SCALE: 800,000 monthly players, 80,000 daily, peak 12,000 concurrent (evenings); matches of 8 players, ~6,000 matches/hour at peak. Game servers themselves are hosted separately — this brief covers the platform backend. Regions: primary us-east-1; latency-sensitive endpoints must respond < 100 ms p95 from US/EU.

PLAYER SERVICES: REST/WebSocket API on ECS Fargate behind an ALB (services: identity/profile, matchmaking, inventory, leaderboards, live-ops). Cognito for player accounts (guest → registered upgrade path). Player profiles, inventory, match history, and entitlements in MongoDB Atlas (M30); hot data (session tokens, active-match state, leaderboard pages) in ElastiCache Redis. Global + weekly leaderboards computed in Redis sorted sets, checkpointed to Atlas.

MATCHMAKING: tickets enter an SQS queue; a matchmaking service groups compatible players (skill band from the rating stored in Atlas, region, mode) and hands the match spec to the game-server fleet via EventBridge. Target: 90% of players matched < 30 seconds.

TELEMETRY: clients and game servers emit gameplay events (match results, item usage, economy transactions, crashes) to Kinesis; a Lambda consumer validates and lands them in S3 (Athena for analyst queries) and updates per-player aggregates in Atlas. ~40M events/day.

AI USE CASES:
1) Dynamic NPC dialogue — the single-player hub uses Amazon Bedrock to generate contextual NPC banter from the player's recent achievements and inventory (with a strict style guide, profanity filter, and response cache in ElastiCache to control cost and latency; fallback to canned lines on any failure).
2) Churn prediction — SageMaker model scores players weekly (session frequency decay, friend-graph activity, progression stalls) from the telemetry lake; high-risk segments get tailored re-engagement offers pushed through the live-ops service; retraining via Step Functions + EventBridge.
3) Balancing insights — after each patch, Bedrock drafts a balance report from Athena aggregates (win rates per loadout, economy inflation signals) for the design team, delivered via SES.
4) Toxicity screening — chat messages pass a Bedrock screening layer; flagged content is muted pending review — same pattern as report handling.

SECURITY & ANTI-CHEAT SUPPORT: WAF + rate limiting on public endpoints, signed client sessions, server-authoritative economy writes only, KMS at rest, Secrets Manager, GuardDuty, CloudTrail. Economy transactions are append-only events (replayable for fraud investigations).

OPERATIONS: CloudWatch dashboards (auth latency, matchmaking wait time, queue depth, Redis memory, telemetry lag), alarms via SNS to the live-ops channel, X-Ray on the matchmaking path. Live-ops console for events/offers configuration stored in Atlas.

BACKUP & DR: Atlas point-in-time (RPO 15 min); leaderboards and caches rebuildable from Atlas + event archive; S3 versioning. RTO 2 hours for player services.

BUDGET & COST: show cheapest vs. best practice; separate always-on costs from peak-scaling costs, and quantify the Bedrock NPC feature per 1,000 daily players so we can decide its rollout scope.`,
  },
  {
    id: 'edtech-lms',
    title: 'EdTech learning platform with AI tutor',
    tagline: 'Course delivery, assessments, progress analytics, RAG tutor over course content',
    services: ['CloudFront', 'ECS', 'Atlas Search', 'Vector Search', 'Bedrock', 'Athena'],
    prompt: `Design an AWS + MongoDB Atlas architecture for an online learning platform (LMS) used by universities and companies: courses with video + text lessons, quizzes, assignments, cohort discussions, and an AI tutor.

GOAL: dependable course delivery with meaningful learning analytics, plus an AI tutor that answers strictly from enrolled course materials — a trust requirement from institutional customers.

USERS & SCALE: 300 institutions, 900,000 enrolled learners, 120,000 weekly active; assessment deadlines create sharp Sunday-evening peaks (8,000 concurrent). 4,000 instructors. Region us-east-1 with multi-AZ; 99.9% availability, and quiz submissions must never be lost.

CONTENT & DELIVERY: lesson video via presigned S3 + CloudFront (signed URLs, entitlement-checked); text content, quizzes, and discussions served by ECS Fargate services behind an ALB (services: catalog, learning/progress, assessment, discussion, analytics). Route 53 + WAF. Cognito with SAML federation per institution; roles: learner, instructor, admin.

DATA & STORAGE: MongoDB Atlas (M30) stores courses, enrollments, lesson progress, quiz attempts, and discussions; Atlas Search powers course + discussion search (institution-scoped). Quiz submissions write through an SQS buffer so a database hiccup never drops a submission (worker retries with idempotency keys). Uploaded assignments in S3 with per-institution prefixes.

LEARNING ANALYTICS: interaction events (lesson views, video progress, quiz attempts) stream through Kinesis to S3; Glue catalogs them; Athena powers instructor dashboards (cohort progress, struggling-student detection queries) refreshed hourly; aggregates cached in Atlas for the in-app views.

AI USE CASES:
1) AI tutor (course-scoped RAG) — every course's materials (lesson text, transcripts, slides) are chunked and embedded via Amazon Bedrock into Atlas Vector Search, tagged by course. The tutor endpoint retrieves ONLY from courses the learner is enrolled in, answers via Bedrock with citations to the exact lesson, and refuses out-of-scope questions. Full conversation logs available to instructors for oversight.
2) Quiz-question drafting — instructors generate draft questions from a lesson via Bedrock (with difficulty targets); drafts require instructor approval before publishing.
3) Struggling-learner signals — a SageMaker model flags at-risk learners (progress stall + failed attempts + declining session length) weekly; instructors get a Bedrock-written intervention suggestion per flagged learner via the dashboard and SES digest.
4) Feedback summarization — end-of-course free-text feedback summarized per cohort by Bedrock for program directors.

ACADEMIC INTEGRITY & SECURITY: assessment endpoints rate-limited and WAF-protected; submission timestamps and attempt histories append-only; KMS at rest; Secrets Manager; GuardDuty; CloudTrail; per-institution data isolation enforced at the repository layer and verified by tests. FERPA-style posture: document PII flows and retention.

OPERATIONS: CloudWatch dashboards per service, special Sunday-peak alarm profile (submission queue depth, assessment latency), X-Ray on the assessment path, synthetic canary that takes a quiz hourly.

BACKUP & DR: Atlas point-in-time (RPO 15 min for submissions), S3 versioning, RTO 4 hours; the analytics lake is rebuildable.

BUDGET & COST: institutions are price-sensitive — show cheapest viable vs. best practice, the per-learner-per-month unit cost at 120k weekly actives, and how the AI tutor's Bedrock cost scales per 1,000 tutor questions.`,
  },
  {
    id: 'data-integration',
    title: 'Event-driven data integration hub (ETL)',
    tagline: 'Partner feeds in, canonical model, orchestrated pipelines, AI data-quality watch',
    services: ['EventBridge', 'Step Functions', 'Glue', 'S3', 'Lambda', 'Bedrock'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a data integration hub that ingests product, inventory, and pricing feeds from 120 retail partners in different formats and publishes one clean canonical dataset to internal consumers.

GOAL: replace brittle point-to-point scripts with an observable, replayable, event-driven hub — where a bad partner feed never corrupts the canonical dataset and every record is traceable to its source file.

USERS & SCALE: 120 partners; feeds arrive as SFTP drops, S3 uploads, and API pushes — CSV, JSON, XML, and spreadsheets; ~900 files/day totalling ~40 GB/day, plus 5 near-real-time API feeds (~50 msg/s). 25 internal analysts and 6 data engineers. Consumers: the e-commerce site, BI, and a partner-facing quality portal.

REGION & AVAILABILITY: eu-west-1; pipelines are batch/stream hybrids — ingestion endpoints multi-AZ, processing retryable.

INGESTION EDGES: all inbound paths land raw files in an S3 "landing" bucket (per-partner prefixes, versioned, object-lock 30 days): the API edge (API Gateway + Lambda) writes micro-batches; SFTP arrivals sync via scheduled transfer; direct S3 uploads use partner-scoped IAM. Every landed object emits an EventBridge event.

PIPELINE ORCHESTRATION: EventBridge routes each landing event to a Step Functions workflow: detect format → validate against the partner's contract (schema, required fields, value ranges) → transform to the canonical model (Lambda for light files, Glue jobs for heavy ones) → dedupe/upsert into MongoDB Atlas (the canonical store: products, offers, inventory positions with full source lineage per field) → publish a "dataset updated" event. Rejected records quarantine to a per-partner S3 prefix with machine-readable reasons; partners see them in the quality portal. Glue maintains the catalog over landing + curated zones; Athena serves engineering forensics ("show me everything partner X sent on the 3rd").

CANONICAL SERVING: internal consumers read via a versioned REST API (API Gateway + Lambda) backed by Atlas with ElastiCache for hot product lookups; bulk consumers get nightly curated extracts to S3. Atlas Search powers the catalog-management UI.

AI USE CASES:
1) Data-quality anomaly watch — daily Step Functions job computes per-partner feed statistics (volume, null rates, price distributions); a SageMaker anomaly model flags feeds that look wrong even when schema-valid (e.g., all prices suddenly 10x), pausing auto-publish for that partner pending review.
2) Rejection explanations — Amazon Bedrock turns machine validation errors into partner-friendly guidance in the quality portal ("Row 1,204: 'colour' expected one of your agreed values; you sent 'nvy' — did you mean 'navy'?"), cutting support tickets.
3) Mapping assistant — when onboarding a new partner, Bedrock proposes field mappings from a sample file to the canonical model; engineers review/approve, and the approved mapping becomes the partner contract.

OPERATIONS & GOVERNANCE: per-partner pipeline dashboards in CloudWatch (freshness, reject rate, processing time), alarms on missed feeds via SNS; full lineage: every canonical field carries source file + row provenance. CloudTrail, KMS, Secrets Manager for partner credentials, GuardDuty.

BACKUP & DR: landing bucket is the source of truth (versioned + object-lock); the canonical store is rebuildable by replaying pipelines — document and TEST the replay runbook quarterly. Atlas point-in-time backup, RPO 1 hour, RTO 8 hours acceptable.

BUDGET & COST: mostly steady batch — optimize for cost; show cheapest vs. best practice and where Glue versus Lambda processing breaks even by file size.`,
  },
  {
    id: 'api-platform',
    title: 'Public API platform with usage-based billing',
    tagline: 'Developer portal, API keys & quotas, metering pipeline, AI developer support',
    services: ['API Gateway', 'Lambda', 'Kinesis', 'Atlas', 'Bedrock', 'SES'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a public data-API business (geocoding + address validation) sold to developers on usage-based plans, with a self-service developer portal.

GOAL: a low-latency public API with trustworthy metering (customers are billed per call — the meter must be beyond dispute), painless developer onboarding, and AI-assisted support that deflects routine tickets.

USERS & SCALE: 3,500 developer accounts across free/pro/enterprise tiers; 90M API calls/month (~35/s sustained, 400/s peak); p95 latency budget 120 ms for the core endpoints. 12 staff (devrel, support, billing). Region us-east-1 multi-AZ; 99.95% availability for the API plane; the portal can be 99.9%.

API PLANE: API Gateway with usage plans + API keys per subscription tier fronting Lambda handlers for the core endpoints; reference datasets cached in ElastiCache with Atlas as the system of record. WAF for abuse control; Route 53; CloudFront in front of the portal and docs. Hard per-tier rate limits at the gateway (free: 5 rps, pro: 50 rps, enterprise: custom).

METERING & BILLING PIPELINE: every request emits a metering record (key, endpoint, latency, response class) — API Gateway access logs stream through Kinesis into: (a) a Lambda aggregator maintaining near-real-time usage counters per account in Atlas (drives the portal's live usage view and quota warnings), and (b) S3 as the immutable metering archive. Nightly Step Functions job reconciles counters against the archive with Athena, computes billable usage, generates invoices, and emails them via SES. Any counter/archive mismatch above 0.1% raises an alarm — the archive wins.

DEVELOPER PORTAL: Next.js portal (S3 + CloudFront) with Cognito sign-in; self-service key management, plan upgrades, usage charts, and docs. Portal API on Lambda; subscriptions, plans, and invoices in Atlas; payment execution via the PSP with webhooks into SQS.

AI USE CASES:
1) Support copilot — a RAG assistant over docs, changelogs, and resolved tickets (Bedrock embeddings + Atlas Vector Search, answers via Bedrock with citations) embedded in the portal; it drafts replies for human agents on escalated tickets rather than replying autonomously to complex cases.
2) Usage-anomaly alerts for customers — a SageMaker detector watches each account's traffic pattern and warns THEM ("your usage doubled since yesterday — a deploy loop?") via SES before bill shock; opt-out per account.
3) Integration-error digests — Bedrock summarizes each account's most common 4xx patterns weekly into one actionable email ("83% of your errors are missing the region parameter…"), reducing support volume.
4) Docs drift check — nightly Bedrock pass compares endpoint schemas to the published docs and files discrepancies to the devrel backlog.

SECURITY & TRUST: keys hashed at rest, KMS everywhere, Secrets Manager, CloudTrail with integrity validation (billing disputes!), GuardDuty, strict IAM. Status page fed by CloudWatch synthetics hitting every endpoint each minute from three regions.

OPERATIONS: dashboards for latency per endpoint, error budgets, quota-hit rates, metering pipeline lag; alarms via SNS; X-Ray on the core path.

BACKUP & DR: Atlas point-in-time; the S3 metering archive is versioned + object-locked (it is the billing source of truth). RPO 5 minutes on metering, RTO 2 hours on the API plane.

BUDGET & COST: unit economics matter — show cheapest vs. best practice AND the infrastructure cost per 1M API calls in each configuration.`,
  },
  {
    id: 'booking-marketplace',
    title: 'Booking marketplace with dynamic pricing',
    tagline: 'Two-sided marketplace, search & availability, payments flow, AI pricing + review summaries',
    services: ['ECS', 'Atlas Search', 'ElastiCache', 'SQS', 'SageMaker', 'Bedrock'],
    prompt: `Design an AWS + MongoDB Atlas architecture for a two-sided booking marketplace where independent venues (studios, courts, meeting rooms) list availability and customers search, book, and pay by the hour.

GOAL: search that feels instant, bookings that never double-book, payouts venues trust, and AI features (dynamic pricing suggestions, review summaries) that raise marketplace liquidity.

USERS & SCALE: 12,000 venues with ~450,000 bookable slots/week; 350,000 registered customers, 25,000 bookings/day, peak booking rate 40/s (weekday 9-11am). Region eu-west-1 multi-AZ; 99.9% availability; the booking-confirmation path must be strongly consistent.

SEARCH & DISCOVERY: customers search by activity, location, time window, and price. MongoDB Atlas holds venues, slots, bookings, reviews; Atlas Search powers text + faceted search; geospatial indexes handle "within 5 km" filters. Hot search results and venue pages cached in ElastiCache with short TTLs; availability checks always hit Atlas (never stale). CloudFront + Route 53 + WAF in front; venue photos in S3 via CloudFront.

BOOKING & CONSISTENCY: booking service on ECS Fargate behind an ALB: reservation uses an atomic conditional update on the slot document (single-document atomicity — no distributed locks), holds the slot for 10 minutes pending payment, then confirms or releases via a delayed SQS message. Every booking state change is an append-only event (audit + analytics). Payments through the PSP; webhooks land in SQS with signature verification; refunds and payout calculations are worker jobs; venue payout statements monthly via Step Functions + SES.

NOTIFICATIONS & CALENDARS: confirmations/reminders via SES and push; venue calendar sync (iCal export, Google two-way for pro venues) through dedicated workers with per-venue rate limits.

AI USE CASES:
1) Dynamic pricing suggestions — a SageMaker model suggests per-slot price adjustments from historical occupancy, day/time seasonality, local demand signals, and lead time; venues see suggestions with predicted occupancy impact and accept/decline (never auto-applied); accepted suggestions feed back as training data. Weekly retraining via Step Functions.
2) Review summaries — Amazon Bedrock condenses each venue's reviews into a balanced summary + pros/cons chips on the venue page, refreshed when 5+ new reviews arrive (EventBridge rule); flagged-review screening runs through Bedrock before publication.
3) Search-intent expansion — free-text queries ("quiet place to record a podcast for 3 people") map to structured filters via Bedrock, backed by Atlas Vector Search over venue descriptions for semantic matches.
4) Supply-gap reports — monthly Bedrock-written report per city for the marketplace team: searched-but-unavailable combinations, price-sensitivity signals, venue categories to recruit.

SECURITY & COMPLIANCE: Cognito for both sides (venue staff roles per location), KMS, Secrets Manager for PSP keys, GuardDuty, CloudTrail; GDPR export/erasure workflows; no card data stored (PSP tokens only).

OPERATIONS: CloudWatch dashboards (search latency, booking success rate, hold-expiry sweep health, webhook lag), alarms via SNS, X-Ray on the booking path, synthetic canary booking hourly against a test venue.

BACKUP & DR: Atlas point-in-time (RPO 5 min on bookings), S3 versioning, event archive in S3 for replay. RTO 2 hours on booking, 6 hours on search ranking extras.

BUDGET & COST: compare cheapest vs. best practice; quantify the caching layer's effect on the Atlas tier required, and give the marginal cost per 1,000 additional daily bookings.`,
  },
  {
    id: 'this-app',
    title: 'This app, deployed on AWS + Atlas',
    tagline: 'A meta example: the AI diagram generator you’re using right now, as a real AWS + Atlas system',
    services: ['ECS', 'CloudFront', 'WAF', 'Atlas', 'Atlas Search', 'Secrets Manager'],
    prompt: `Design an AWS + MongoDB Atlas architecture for an AI-powered cloud architecture design tool: users describe a system in plain language in a chat interface, and the backend runs an agentic loop against an LLM (grounded in official AWS and MongoDB documentation via their MCP servers) to progressively build a costed, editable diagram in real time.

GOAL: a trustworthy, cost-conscious generation experience — every recommendation grounded in official sources where possible, every price either exact (from the official AWS Pricing API) or honestly labelled indicative, and the diagram building up on screen incrementally rather than appearing all at once after a long wait.

USERS & SCALE: a small-to-mid SaaS product, ~5,000 registered users, ~400 daily active, modest concurrency (peak ~50 concurrent generation sessions) — this is a tool, not a high-throughput consumer app. Each user owns multiple projects; projects can be shared read/write with teammates. Single region is fine to start.

REGION & AVAILABILITY: us-east-1, multi-AZ for the application tier. A brief maintenance window is acceptable; there is no hard real-time SLA — generation turns are expected to take tens of seconds, not milliseconds.

APPLICATION LAYER: a Next.js server (SSR pages plus API routes) needs to run as a long-lived, streaming-capable service — several endpoints stream newline-delimited JSON progress events over a single HTTP connection while a generation turn runs, so it should sit on ECS Fargate behind an Application Load Balancer rather than short-lived request/response compute. Static assets and the app shell are served through CloudFront, with Route 53 DNS and WAF (rate limiting + basic managed rule groups) in front of every public endpoint. TLS via Certificate Manager.

AUTH: self-serve email + password sign-up with a required email-verification step before the workspace unlocks (a signed, expiring token emailed to the user); sessions are short-lived signed tokens, not server-side session storage. Password reset follows the same emailed-token pattern. Transactional email (verification, reset, and password-changed notices) goes out through a mail-sending service — no marketing email, low volume.

DATA & STORAGE: MongoDB Atlas (M10-M20 to start) is the system of record for everything: user accounts, projects, the architecture documents themselves (nodes/edges/typed boundary containers/annotations, with an optimistic-concurrency version field), the persistent chat/conversation thread per project, a structured trace of every generation run (for a "show your work" replay view), and computed cost-estimate snapshots. Atlas Search powers project search. A small set of collections cache officially-sourced facts that don't change per request — architecture best-practice guidance keyed by recognized request pattern, and AWS regional service-availability checks — each with its own staleness/TTL policy, so a repeat or similar request reuses what was already fetched instead of re-querying the official tools every time.

GENERATION PIPELINE (the core of the product): a chat message kicks off a bounded, multi-step server-side loop — classify the request's scope (a full new design vs. a small edit, so trivial edits skip unnecessary steps), consult the official AWS and MongoDB Atlas documentation servers (Model Context Protocol) for grounding on genuinely new/complex requests, plan the diagram in small incremental slices from the configured LLM provider (a pluggable OpenAI-compatible or Anthropic-compatible endpoint) with each slice streamed to the client as soon as it's applied, auto-arrange the layout, price every service, run deterministic structural validation plus an LLM review pass, and refine for up to a few bounded iterations if something's missing — never an unbounded agent loop. The external LLM provider enforces a requests-per-minute cap, so calls within a turn are paced with a small delay rather than fired back-to-back.

PRICING: per-service cost comes from the official AWS Pricing API first; when that's unavailable the UI clearly labels the figure indicative rather than presenting a guess as fact. Two report exports are available per project: a technical breakdown for engineers and a plain-language, cost-framed proposal for a business stakeholder, both cached per architecture version and re-generated only when the diagram actually changes.

SECURITY: Secrets Manager for the LLM API key, database credentials, and mail-provider key; KMS encryption at rest; least-privilege IAM per service; CloudTrail and GuardDuty enabled account-wide; no card/payment data is handled by this system at all.

OPERATIONS & MONITORING: CloudWatch dashboards for generation-turn duration, LLM/MCP call failure rate, and queue-style pacing delays; alarms on elevated failure rate or sustained provider timeouts; structured application logs correlate to each generation run's stored trace for debugging a specific user's turn.

BACKUP & DR: Atlas Cloud Backup with point-in-time recovery (a corrupted or bad-refine architecture edit should be recoverable); RPO 15 minutes, RTO a few hours — this is a productivity tool, not a transactional system, so aggressive DR spend isn't warranted.

BUDGET & COST: this is a cost-conscious indie/small-team product, not enterprise scale — show the cheapest viable configuration (small Atlas tier, minimal Fargate task count with autoscaling) alongside a best-practice configuration, and call out which single line item (likely the LLM API spend itself, not the AWS infrastructure) actually dominates the monthly bill.`,
  },
  {
    id: 'hld-ride-sharing',
    title: 'High-level system design: ride-sharing platform',
    tagline: 'Provider-neutral HLD — clients, edge, services, data, and async flows',
    services: ['Load Balancer', 'API Gateway', 'Services', 'Cache', 'Queue', 'Databases'],
    prompt: `Draw a generic high-level system design (HLD) diagram — no cloud vendor, just provider-neutral components — for a ride-sharing platform like a small Uber.

USERS & CLIENTS: rider mobile app, driver mobile app, and an internal operations web dashboard.

CORE FLOWS: riders request trips and see nearby drivers on a live map; drivers receive dispatch offers in real time over persistent connections; pricing applies surge multipliers; trips are matched by a dedicated matching service; payments are captured through a third-party payment provider after each trip; receipts go out by email/push.

COMPONENTS I EXPECT: DNS and a CDN for static assets; a load balancer in front of an API gateway; separate microservices for riders/trips, driver location, matching, pricing, and payments; a WebSocket server for live driver-location and dispatch updates; Redis-style cache for hot geo lookups and session data; a message queue between trip events and the downstream billing/notification workers; a relational database for trips and payments; a NoSQL store for high-write driver location pings; a data warehouse fed asynchronously for analytics.

CONVENTIONS: wrap everything we own in a system boundary; keep the payment provider and map-tiles provider outside it as external APIs; group components into Client / Edge / Application / Data tiers; label every connection with what flows and the protocol (REST/HTTPS, WebSocket, async events); mark the async paths explicitly.`,
  },
  {
    id: 'lld-order-service',
    title: 'Low-level design: order service internals',
    tagline: 'Provider-neutral LLD — controllers, services, repositories, entities, layers',
    services: ['Controller', 'Service class', 'Repository', 'Entity', 'DTO', 'Interface'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the ORDER SERVICE inside an e-commerce backend.

SCOPE: one deployable service; show its internal structure in three layers — Controller layer, Service layer, Data layer.

CONTROLLER LAYER: an OrderController handling the REST endpoints (create order, get order, cancel order, list orders by customer), validating requests and mapping them to/from DTOs (CreateOrderRequest, OrderResponse).

SERVICE LAYER: an OrderService class holding the business logic (stock check, price calculation, state transitions); a PaymentGateway interface with a StripeAdapter implementation so the payment provider is swappable; a DiscountPolicy interface with at least one concrete strategy; an OrderCreatedEvent published to a message broker via an EventPublisher component; an OrderEventHandler consuming inventory-reserved events back.

DATA LAYER: an OrderRepository (interface + implementation) persisting Order and OrderLine entities to the orders and order_lines tables; an outbox table written in the same transaction as the order for reliable event publishing.

CONVENTIONS: dependencies must point inward (controller → service → repository → tables); label edges with the relationship (calls, implements, reads/writes, publishes, subscribes); group each layer in its own boundary; mark DTOs crossing the controller boundary and the interfaces where substitution matters.`,
  },
  {
    id: 'hld-url-shortener',
    title: 'High-level system design: URL shortener',
    tagline: 'The classic interview HLD — read-heavy caching, key generation, analytics',
    services: ['CDN', 'Load Balancer', 'Service', 'Cache', 'NoSQL DB', 'Stream'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral, no cloud vendor — for a URL shortener like bit.ly.

USERS & SCALE: 100M short links created per year, redirects are read-heavy at roughly 100:1 read-to-write; p99 redirect latency must stay under 50ms worldwide.

CORE FLOWS: (1) create — an authenticated user posts a long URL and gets a short code back; (2) redirect — anyone hitting a short link is 301-redirected to the long URL as fast as possible; (3) analytics — every redirect is counted per link (clicks, referrer, country) without slowing the redirect path.

COMPONENTS I EXPECT: DNS and a CDN/edge layer in front; a load balancer feeding an API gateway; a Shortening service that consults a dedicated Key Generation service (pre-generated collision-free codes); a Redirect service on the hot path backed by a Redis-style cache (cache-aside, ~80%+ hit rate) with a NoSQL store as the source of truth for code → URL mappings; redirects publish click events to a stream processor that aggregates into an analytics store read by a reporting dashboard; a rate limiter protecting the create path; an auth service for API users.

CONVENTIONS: wrap owned components in a system boundary; group into Client / Edge / Application / Data tiers; label every edge with what flows and how (HTTP 301, cache read-through, async click events); mark the redirect read path and the async analytics path distinctly.`,
  },
  {
    id: 'hld-chat-app',
    title: 'High-level system design: realtime chat',
    tagline: 'WebSockets, presence, fan-out, message history — WhatsApp-style HLD',
    services: ['WebSocket', 'API Gateway', 'Services', 'Pub/Sub', 'Queue', 'NoSQL DB'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral — for a realtime chat application (1:1 and small group conversations, WhatsApp-style).

USERS & SCALE: 5M registered users, 500k concurrently connected at peak; each connected client holds one persistent connection; messages must deliver to online recipients in under 500ms.

CORE FLOWS: clients connect over WebSocket to stateful gateway servers; a Chat service persists each message, then fans it out via pub/sub to whichever gateway holds the recipient's connection; offline recipients get the message on reconnect (sync from history) plus a push notification through an external push provider; a Presence service tracks online/last-seen using the cache; media attachments upload through a separate path to blob storage and are served via CDN; message history is stored in a NoSQL store partitioned by conversation.

COMPONENTS I EXPECT: mobile + web clients; DNS/load balancer; WebSocket gateway servers; API gateway for the REST parts (login, history sync, media); Chat, Presence, and Notification services; pub/sub for message fan-out between gateways; a queue feeding the Notification worker; Redis-style cache for presence and recent conversations; NoSQL message store; blob storage + CDN for media; auth service issuing tokens; the push-notification provider outside the boundary as an external API.

CONVENTIONS: system boundary around owned components; Client / Edge / Application / Data tiers; label edges with protocol and intent (WebSocket, REST/HTTPS, publishes/subscribes, async); show the online fan-out path and the offline notification path separately.`,
  },
  {
    id: 'lld-notification-module',
    title: 'Low-level design: notification module',
    tagline: 'Strategy + template patterns — channels, retries, preferences, outbox',
    services: ['Controller', 'Interface', 'Service class', 'Event Handler', 'Repository', 'DB Table'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of a NOTIFICATION MODULE inside a larger backend.

SCOPE: one deployable service consuming domain events and delivering notifications over multiple channels (email, SMS, push, in-app). Show three layers: an event/API layer, a service layer, and a data layer.

EVENT/API LAYER: a NotificationEventHandler subscribing to domain events (OrderShippedEvent, PaymentFailedEvent) from the message broker, plus a small NotificationController exposing REST endpoints for listing a user's in-app notifications and updating channel preferences (PreferencesRequest/NotificationResponse DTOs).

SERVICE LAYER: a NotificationService orchestrating: it loads the user's ChannelPreferences, renders content through a TemplateEngine component (per-channel templates), and dispatches through a NotificationChannel interface with EmailChannel, SmsChannel, and PushChannel implementations (strategy pattern — each wraps an external provider SDK as an external dependency). A RetryPolicy component wraps failed sends with backoff; permanently failed sends go through a DeadLetterHandler.

DATA LAYER: a NotificationRepository persisting Notification entities to the notifications table (status: pending/sent/failed); a PreferenceRepository over the channel_preferences table; an outbox pattern is NOT needed here — this module is a consumer.

CONVENTIONS: dependencies point inward (handler/controller → service → repository → tables); label edges (subscribes, calls, implements, reads/writes); group each layer in its own boundary; mark the NotificationChannel interface and its three implementations explicitly, and keep the provider SDKs shown as external dependencies at the edge.`,
  },
  {
    id: 'lld-auth-module',
    title: 'Low-level design: auth & session module',
    tagline: 'Token issuance, middleware, repositories — login/refresh flows in one service',
    services: ['Controller', 'Service class', 'Interface', 'Repository', 'Entity', 'DTO'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the AUTHENTICATION & SESSION MODULE of a web backend.

SCOPE: one service handling registration, login, token refresh, and logout, plus the middleware other modules use to authorize requests. Three layers: Controller layer, Service layer, Data layer.

CONTROLLER LAYER: an AuthController with register/login/refresh/logout endpoints using RegisterRequest, LoginRequest, and TokenResponse DTOs; an AuthMiddleware component that other controllers call to validate access tokens on every request.

SERVICE LAYER: an AuthService holding the flows — it verifies credentials through a PasswordHasher interface (BcryptHasher implementation), issues short-lived access tokens and rotating refresh tokens through a TokenIssuer component, and records logins; a TokenValidator component used by the middleware (signature + expiry + revocation check); a RateLimitGuard protecting login attempts; a MfaProvider interface (TotpProvider implementation) for optional two-factor; an AccountLockedEvent published through an EventPublisher when repeated failures lock an account.

DATA LAYER: a UserRepository over the users table (User entity with hashed credentials); a RefreshTokenRepository over the refresh_tokens table (token family, rotation, revocation); an AuditRepository appending to the auth_audit table.

CONVENTIONS: dependencies point inward (controller/middleware → service → repositories → tables); label edges (calls, implements, reads/writes, publishes); group layers in their own boundaries; mark the interfaces (PasswordHasher, MfaProvider) and the DTOs crossing the controller boundary explicitly.`,
  },
  {
    id: 'hld-food-delivery',
    title: 'High-level system design: food delivery',
    tagline: 'Three-sided marketplace — ordering, dispatch, live tracking, payments',
    services: ['API Gateway', 'Services', 'WebSocket', 'Queue', 'Cache', 'NoSQL DB'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral, no cloud vendor — for a food-delivery platform (customer app, restaurant tablet, courier app — think a small DoorDash).

USERS & SCALE: 200,000 customers across 8 cities, 3,000 restaurants, 5,000 couriers; 30,000 orders/day with a sharp dinner peak (~15 orders/s); courier GPS pings every 5 seconds while on shift.

CORE FLOWS: customers browse restaurants by location and place orders; restaurants accept and mark food ready on a tablet; a dispatch service offers the job to nearby couriers; customers watch the courier's position live until handover; payment is captured through an external payment provider at order time and split between platform and restaurant at settlement; every status change notifies the right party.

COMPONENTS I EXPECT: DNS and a CDN for static assets and food images; a load balancer in front of an API gateway; separate services for catalog/search (geo-filtered restaurant listings), ordering (order state machine: placed → accepted → prepared → picked up → delivered), dispatch/matching (courier assignment from live positions), courier-location ingestion, pricing/promotions, and payments; a WebSocket server pushing live tracking to customers and order updates to restaurant tablets; a Redis-style cache for hot menus and geo lookups; a message queue decoupling order events from notifications, receipts, and analytics; a relational database for orders and payments; a NoSQL store for high-write courier location pings; a data warehouse fed asynchronously; the payment provider, maps provider, and push-notification provider outside the boundary as external APIs.

CONVENTIONS: wrap owned components in a system boundary; group into Client / Edge / Application / Data tiers; label every edge with what flows and how (REST/HTTPS, WebSocket, async events); show the synchronous order path and the async notification/analytics paths distinctly.`,
  },
  {
    id: 'hld-video-streaming',
    title: 'High-level system design: video streaming',
    tagline: 'Upload → transcode → CDN playback, plus discovery and view analytics',
    services: ['CDN', 'Blob Storage', 'Queue', 'Workers', 'Cache', 'Stream'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral — for a video-on-demand streaming platform (creators upload, viewers stream — think a small YouTube).

USERS & SCALE: 50,000 creators uploading 2,000 videos/day (average 15 minutes), 2M viewers, 40,000 concurrent streams at evening peak; playback must start in under 2 seconds and adapt to the viewer's bandwidth.

CORE FLOWS: (1) upload — creators upload large files in resumable chunks straight to blob storage; a processing pipeline validates each file, transcodes it into an adaptive-bitrate ladder (1080p/720p/480p), generates thumbnails, and marks the video ready; (2) playback — viewers fetch a manifest and stream segments from the CDN using signed URLs (entitlement-checked); (3) discovery — search over titles/descriptions plus a recommendation service ranking the home page; (4) analytics — player heartbeats (view counts, watch time, rebuffering) flow through a stream processor without ever touching the serving path.

COMPONENTS I EXPECT: DNS and a CDN as the delivery edge; a load balancer feeding an API gateway; an upload service issuing resumable upload sessions; blob storage for masters and renditions; a transcoding queue with a horizontally scaled worker fleet (the elastic, failure-prone part — show retries and a dead-letter path); a metadata service backed by a document or relational database; a search service with its index; a recommendation service reading precomputed models; a playback/entitlement service signing URLs; a Redis-style cache for hot video metadata; a stream processor aggregating heartbeats into an analytics store; an auth service; the push/email provider outside the boundary as an external API.

CONVENTIONS: system boundary around owned components; Client / Edge / Application / Data tiers; label edges with what flows and how (chunked upload, async jobs, HLS segments via CDN, heartbeat events); show the upload/processing pipeline and the playback path as clearly separate flows.`,
  },
  {
    id: 'hld-social-feed',
    title: 'High-level system design: social news feed',
    tagline: 'Fan-out on write vs. read, timeline caching, ranked feeds at scale',
    services: ['Feed service', 'Graph service', 'Queue', 'Cache', 'NoSQL DB', 'CDN'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral — for the news-feed backend of a social network (posts, follows, ranked home timeline).

USERS & SCALE: 10M registered users, 1M daily active; 500,000 new posts/day; the average user follows 300 accounts; a few celebrity accounts have 5M+ followers; the home feed must load in under 300ms p95 and is read roughly 100x more often than it is written.

CORE FLOWS: (1) post — a user publishes text/media; media goes to blob storage and is served via CDN; the post is persisted and fanned out; (2) fan-out on write — a feed service pushes the post id into each follower's precomputed timeline through queue workers — EXCEPT for celebrity accounts, whose posts are merged in at read time (fan-out on read) to avoid millions of timeline writes per post; (3) read — the home feed pulls the user's precomputed timeline from cache, merges in celebrity posts, and passes the candidates through a ranking service before returning; (4) engagement — likes and reposts are aggregated by a counting service fed by an event stream, never counted synchronously on the read path.

COMPONENTS I EXPECT: DNS/CDN at the edge; a load balancer in front of an API gateway; a post service; a social-graph service (follows) with its own store; a feed/fan-out service consuming a queue of post events; a timeline store (NoSQL, one capped list per user); a Redis-style cache in front of timelines and hot posts; a ranking service; a counting service on the event stream; a media pipeline (blob storage, resize workers, CDN); a notification service on the same queue; an auth service; the push provider external.

CONVENTIONS: system boundary; Client / Edge / Application / Data tiers; label edges (REST/HTTPS, async fan-out events, cache reads); make the write path (post → fan-out → timelines) and the read path (cache → merge → rank) visually distinct, and annotate the celebrity fan-out-on-read exception.`,
  },
  {
    id: 'hld-notification-platform',
    title: 'High-level system design: notification platform',
    tagline: 'Multi-channel delivery — priority queues, preferences, provider webhooks',
    services: ['Event topic', 'Priority queues', 'Workers', 'Cache', 'NoSQL DB', 'External APIs'],
    prompt: `Draw a generic high-level system design (HLD) diagram — provider-neutral — for a centralized notification platform that every product team in a company sends through (email, SMS, push, in-app).

USERS & SCALE: 40 internal producer services; 80M notifications/day (~1,000/s sustained, 10,000/s during campaign blasts); transactional messages (password resets, receipts) must deliver within seconds and NEVER be dropped; marketing blasts are throughput-oriented and may be throttled.

CORE FLOWS: producer services publish notification requests to an ingestion API or an event topic; the platform validates and enriches each request, checks the user's channel preferences and quiet hours, renders the message from a versioned template, rate-limits per user and per channel, then routes it to a channel-specific worker pool that calls the external provider; delivery receipts flow back via provider webhooks and update message status; failed sends retry with backoff and eventually dead-letter for operator review.

COMPONENTS I EXPECT: an ingestion API and an event topic as the two entry points; a validation/enrichment service; a preference service with its own store (per-user channel opt-ins, quiet hours, locale); a template service with versioned templates; two priority queues (transactional vs. bulk) so campaign blasts can never starve password resets; per-channel worker fleets (email, SMS, push, in-app) each wrapping an external provider API; a rate limiter backed by a cache; a delivery-status service consuming provider webhooks; a message-status store (NoSQL, high write volume) plus an analytics stream into a warehouse; a dead-letter queue with an operator review tool; the email/SMS/push providers outside the boundary as external APIs.

CONVENTIONS: system boundary around owned components; group into Ingestion / Processing / Delivery / Data tiers; label edges (publishes, consumes, REST/HTTPS, webhooks); make the transactional and bulk priority paths visually distinct, and show the receipt/status feedback loop from the providers back into the platform.`,
  },
  {
    id: 'lld-payment-module',
    title: 'Low-level design: payment module',
    tagline: 'State machine, provider adapters, idempotency, double-entry ledger, outbox',
    services: ['Controller', 'State machine', 'Interface', 'Adapter', 'Repository', 'Outbox'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the PAYMENT MODULE inside an e-commerce backend.

SCOPE: one deployable service that authorizes, captures, and refunds payments through interchangeable payment providers, keeps an append-only ledger, and never charges twice. Three layers: API layer, Service layer, Data layer.

API LAYER: a PaymentController with initiate-payment, get-payment-status, and refund endpoints (InitiatePaymentRequest, RefundRequest, PaymentResponse DTOs) — every write endpoint requires a client idempotency key; a separate WebhookController receiving provider callbacks, passing each through a SignatureVerifier component before anything else touches it.

SERVICE LAYER: a PaymentService that orchestrates but holds no provider-specific logic; a PaymentStateMachine owning the only legal transitions (created → authorized → captured → settled, with failed and refunded branches) — nothing mutates payment state except through it; a PaymentProvider interface with StripeAdapter and AdyenAdapter implementations (adapter pattern — each wraps its provider SDK, shown as an external dependency); an IdempotencyGuard that checks and stores request keys so a retried call returns the original outcome instead of charging again; a RefundPolicy component enforcing refund windows and partial-refund rules; a LedgerWriter turning every state change into balanced double-entry records; PaymentCapturedEvent and PaymentFailedEvent published via an EventPublisher.

DATA LAYER: a PaymentRepository over the payments table (state, provider reference, version column for optimistic locking); a LedgerRepository appending to the ledger_entries table (append-only — never updated or deleted); an IdempotencyKeyRepository over the idempotency_keys table (key, request hash, stored response, expiry); an outbox table written in the same transaction as payment state changes for reliable event publishing.

CONVENTIONS: dependencies point inward (controllers → services → repositories → tables); label edges (calls, implements, reads/writes, appends, publishes); group each layer in its own boundary; mark the PaymentProvider interface with both adapters explicitly, keep the provider SDKs at the edge as external dependencies, and make the append-only ledger visually distinct from mutable state.`,
  },
  {
    id: 'lld-inventory-module',
    title: 'Low-level design: inventory & reservations',
    tagline: 'Optimistic locking, reservation expiry, swappable availability policies',
    services: ['Event Handler', 'Service class', 'Interface', 'Repository', 'Entity', 'DB Table'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the INVENTORY & RESERVATION MODULE inside an e-commerce backend.

SCOPE: one deployable service that tracks stock per SKU per warehouse, reserves stock when orders are placed, releases expired reservations, and never oversells under concurrent checkouts. Three layers: event/API layer, Service layer, Data layer.

EVENT/API LAYER: an InventoryEventHandler subscribing to OrderCreatedEvent (reserve stock) and OrderCancelledEvent (release it) from the message broker; an InventoryController with get-stock, adjust-stock (warehouse staff), and reservation-status endpoints (AdjustStockRequest, StockResponse DTOs).

SERVICE LAYER: an InventoryService for reads and manual adjustments; a ReservationService holding the critical path — check availability, write the reservation, and decrement the available count in one atomic operation guarded by optimistic locking (retry on version conflict with bounded attempts); an AvailabilityPolicy interface with StrictPolicy and BackorderPolicy implementations so out-of-stock behavior is swappable per product line; a ReservationSweeper scheduled component that expires unconfirmed reservations and returns their stock; StockReservedEvent, ReservationExpiredEvent, and LowStockEvent published via an EventPublisher (LowStockEvent drives replenishment in another module).

DATA LAYER: a StockRepository over the stock_items table (sku, warehouse, on_hand, reserved, version — the optimistic-lock column); a ReservationRepository over the reservations table (status: held/confirmed/expired, expires_at, order reference); a MovementRepository appending every change to the stock_movements table so any balance is re-derivable for audit.

CONVENTIONS: dependencies point inward (handler/controller → services → repositories → tables); label edges (subscribes, calls, implements, reads/writes, appends, publishes); group layers in their own boundaries; mark the optimistic-locking retry on the ReservationService → StockRepository edge and the AvailabilityPolicy interface with both implementations explicitly.`,
  },
  {
    id: 'lld-file-upload-module',
    title: 'Low-level design: file upload & media module',
    tagline: 'Chunked uploads, storage adapters, virus-scan quarantine, tenant quotas',
    services: ['Controller', 'Interface', 'Service class', 'Worker', 'Repository', 'DB Table'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the FILE UPLOAD & MEDIA MODULE inside a SaaS backend.

SCOPE: one deployable service handling large chunked uploads, malware scanning, thumbnail generation, and per-tenant quota enforcement, with the backing store hidden behind an interface. Three layers: API layer, Service layer, Data layer.

API LAYER: an UploadController with initiate-upload (returns an upload session plus per-chunk upload targets), complete-upload, and abort endpoints, plus a FileController for metadata, download links, and delete (InitiateUploadRequest, FileResponse DTOs); a DownloadLinkIssuer component minting short-lived signed URLs so file bytes never stream through the API itself.

SERVICE LAYER: an UploadService orchestrating the session lifecycle (chunks received → assembled → scanning → ready / rejected); a QuotaGuard checking the tenant's storage allowance before any session opens; a StorageProvider interface with BlobStoreAdapter and LocalDiskAdapter implementations so the backing store is swappable; a MimeValidator sniffing the actual content type (never trusting the client's claim); a VirusScanner interface (ClamAvAdapter implementation) invoked asynchronously after assembly — files stay quarantined until the scan passes; a ThumbnailGenerator worker consuming FileReadyEvent for images and PDFs; FileReadyEvent and FileRejectedEvent published via an EventPublisher.

DATA LAYER: a FileRepository over the files table (owner, tenant, size, content type, status: uploading/scanning/ready/quarantined); an UploadSessionRepository over the upload_sessions table (received-chunk map, expiry); a QuotaRepository over the tenant_quotas table (used vs. allowed bytes, updated in the same transaction that marks a file ready).

CONVENTIONS: dependencies point inward (controllers → services → repositories → tables); label edges (calls, implements, reads/writes, publishes, consumes); group each layer in its own boundary; mark both interfaces (StorageProvider, VirusScanner) with their implementations, and show the quarantine path (scanning → quarantined) as distinct from the happy path.`,
  },
  {
    id: 'lld-search-module',
    title: 'Low-level design: search & indexing module',
    tagline: 'Event-driven index sync, query building, zero-downtime reindex',
    services: ['Event Handler', 'Controller', 'Interface', 'Adapter', 'Repository', 'DB Table'],
    prompt: `Draw a generic low-level design (LLD) diagram — class/component level, no infrastructure — of the SEARCH & INDEXING MODULE inside an e-commerce backend.

SCOPE: one deployable service that keeps a search index in sync with the product catalog through domain events and serves typed search queries — the search engine itself is an external dependency reached only through an interface. Three layers: event/API layer, Service layer, Data layer.

EVENT/API LAYER: an IndexingEventHandler subscribing to ProductCreatedEvent, ProductUpdatedEvent, and ProductDeletedEvent from the message broker (idempotent — event replays must be safe); a SearchController with search and suggest endpoints (SearchRequest with filters/facets/pagination, SearchResponse, SuggestResponse DTOs).

SERVICE LAYER: a SearchService translating requests into engine queries through a QueryBuilder (text match, filters, facets, sort profiles); a DocumentMapper converting catalog entities into flat search documents (denormalizing brand, category path, price bands); an Indexer applying upserts and deletes through a SearchEngineClient interface with an ElasticsearchAdapter implementation; a ReindexOrchestrator that rebuilds the full index into a fresh version and swaps an alias atomically (zero-downtime reindex) — triggered manually or when the mapping version changes; a SynonymProvider feeding managed synonym sets into the QueryBuilder.

DATA LAYER: an IndexCheckpointRepository over the index_checkpoints table (last processed event position per index — the recovery point after a crash); a SynonymRepository over the synonyms table; the search index itself stays OUTSIDE the data layer as an external dependency reached only through SearchEngineClient.

CONVENTIONS: dependencies point inward (handler/controller → services → repositories → tables); label edges (subscribes, calls, implements, reads/writes, upserts); group layers in their own boundaries; mark the SearchEngineClient interface and its adapter explicitly, and show the alias-swap reindex path separately from the incremental event-driven path.`,
  },
];
