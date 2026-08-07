import type { Db } from '../../../src/store/db.js'
import { newId } from '../../../src/types/ids.js'
import type { Claim, OpenQuestion, Recommendation, Requirement } from '../../../src/types/domain.js'
import { createProject, createSession, setSessionStatus } from '../../../src/store/projects.js'
import { createTranscript, freezeTranscript } from '../../../src/store/transcripts.js'
import { insertClaims } from '../../../src/store/claims.js'
import { insertRequirements } from '../../../src/store/artifacts.js'
import { insertQuestions, insertRecommendations } from '../../../src/store/findings.js'

export const DEMO_MARKER_KEY = 'demo-workspace-v1'

const DEMO_TRANSCRIPT = `BA: Thanks for joining. I want to understand the returns process from the customer's first request through the final refund. Could you walk me through the current process and call out the steps that create the most support work?

Client: A customer needs to start a return with the order number and the email used at checkout, and the normal window is thirty days from delivery. Today they email support, an agent searches the commerce system, checks the delivery date, and sends a form back. That back-and-forth is the main source of delay. We want the portal to show the eligible items from that order so the customer does not have to type product details again.

BA: Does the customer have to sign in, or can someone who used guest checkout also start a return?

Client: I think guest customers can use the same return flow without creating an account, but I need to confirm that with customer service. We should verify the email against the order before showing any personal or delivery information. If the lookup fails, the message should tell the customer to check the order number and email, without revealing whether a particular order exists.

BA: What happens once an item is selected?

Client: For eligible items, the portal must create a prepaid shipping label immediately. The label should contain our return address and a tracking number. Some products are final sale, hazardous, or supplied by marketplace partners, but legal and operations still need to give us the definitive exclusion list. Bundles are another unresolved case because nobody has decided whether one item from a bundle can be returned on its own.

BA: How is the refund approved after the package arrives?

Client: The warehouse team must record whether the item passed inspection before finance releases the refund. They check that the serial number matches, choose an item condition, and add a note when the inspection fails. Supervisors can override a failure today, but the new portal needs a clear rule for who can override it and what evidence they must provide. We cannot lose that history because finance uses it when a refund is disputed.

BA: What service level have you promised, and how does the customer know where the return stands?

Client: We usually complete refunds within five business days after inspection, although that target has never been written down. Customers need email updates when the return is submitted, received at the warehouse, approved, and refunded. Support should also see the same status timeline so they can answer a customer without checking three different systems. If the refund provider times out, retrying must not create a second refund.

BA: I will capture the thirty-day eligibility rule, label generation, inspection approval, and status notifications as requirements. I will leave guest access and the five-day refund target as assumptions until their owners confirm them. I will also raise questions about exclusions, partial bundle returns, and supervisor overrides.`

interface ClaimDefinition {
  kind: Claim['kind']
  quote: string
  statement: string
}

const CLAIM_DEFINITIONS: ClaimDefinition[] = [
  {
    kind: 'requirement',
    quote: 'A customer needs to start a return with the order number and the email used at checkout, and the normal window is thirty days from delivery.',
    statement: 'Customers can start a return with an order number and checkout email within thirty days of delivery.',
  },
  {
    kind: 'requirement',
    quote: 'For eligible items, the portal must create a prepaid shipping label immediately.',
    statement: 'The portal generates a prepaid shipping label for each eligible return.',
  },
  {
    kind: 'requirement',
    quote: 'The warehouse team must record whether the item passed inspection before finance releases the refund.',
    statement: 'Warehouse inspection outcome is required before finance releases a refund.',
  },
  {
    kind: 'requirement',
    quote: 'Customers need email updates when the return is submitted, received at the warehouse, approved, and refunded.',
    statement: 'Customers receive email updates at each major return and refund milestone.',
  },
  {
    kind: 'assumption',
    quote: 'I think guest customers can use the same return flow without creating an account, but I need to confirm that with customer service.',
    statement: 'Guest customers can initiate returns without creating an account.',
  },
  {
    kind: 'assumption',
    quote: 'We usually complete refunds within five business days after inspection, although that target has never been written down.',
    statement: 'Refunds should complete within five business days after inspection.',
  },
]

export function seedDemoWorkspace(db: Db): string | null {
  const marker = db
    .prepare('SELECT value FROM app_metadata WHERE key = ?')
    .get(DEMO_MARKER_KEY) as { value: string } | undefined
  if (marker) return null

  return db.transaction(() => {
    const project = createProject(db, {
      name: 'Northstar Returns Portal · Demo',
      domain: 'E-commerce returns and refund operations for a regional retail marketplace',
      regulatoryContext: 'none',
      systemName: 'Northstar Returns Portal',
      glossary: 'RMA: Return merchandise authorization; OMS: Order management system',
    })
    const session = createSession(db, {
      projectId: project.id,
      title: 'Returns workflow discovery',
      occurredAt: '2026-07-28T09:30:00.000Z',
    })
    const { transcript, segments } = createTranscript(db, {
      sessionId: session.id,
      text: DEMO_TRANSCRIPT,
    })
    freezeTranscript(db, transcript.id)

    const createdAt = '2026-07-28T10:30:00.000Z'
    const claims: Claim[] = CLAIM_DEFINITIONS.map(definition => {
      const charStart = DEMO_TRANSCRIPT.indexOf(definition.quote)
      const charEnd = charStart + definition.quote.length
      const segment = segments.find(item => item.charStart <= charStart && item.charEnd >= charEnd)
      if (charStart < 0 || !segment) throw new Error(`Demo quote is not grounded: ${definition.quote}`)
      return {
        id: newId('clm'),
        sessionId: session.id,
        transcriptId: transcript.id,
        segmentId: segment.id,
        quote: definition.quote,
        statement: definition.statement,
        speakerRole: 'client',
        kind: definition.kind,
        status: 'validated',
        charStart,
        charEnd,
        matchMode: 'exact',
        createdAt,
      }
    })
    insertClaims(db, claims)

    const requirementClaims = claims.filter(claim => claim.kind === 'requirement')
    const requirements: Requirement[] = [
      'Customers must be able to start a return with their order number and checkout email within thirty days of delivery.',
      'The portal must generate a prepaid shipping label immediately for each eligible item.',
      'Warehouse staff must record an inspection outcome before finance can release a refund.',
      'The system must email customers when a return is submitted, received, approved, and refunded.',
    ].map((statement, index) => ({
      id: newId('req'),
      projectId: project.id,
      key: `REQ-${String(index + 1).padStart(3, '0')}`,
      statement,
      status: 'proposed',
      origin: 'client-stated',
      originClaimIds: [requirementClaims[index]!.id],
      supersedesId: null,
      createdAt,
    }))
    insertRequirements(db, requirements)

    const questions: OpenQuestion[] = [
      ['Which product categories, marketplace items, and sale types are excluded from returns?', 'domain'],
      ['Can a customer return one item from a bundle, and how should the bundle price be prorated?', 'edge-case'],
      ['Which roles may override a failed warehouse inspection, and what evidence must the audit record retain?', 'compliance'],
    ].map(([text, category], index) => ({
      id: newId('oqn'),
      projectId: project.id,
      key: `OQ-${String(index + 1).padStart(3, '0')}`,
      text: text!,
      category: category as OpenQuestion['category'],
      raisedBySessionId: session.id,
      status: 'open',
      answerText: null,
      answeredBySessionId: null,
      createdAt,
    }))
    insertQuestions(db, questions)

    const recommendations: Recommendation[] = [
      {
        text: 'Use idempotency keys for shipping-label creation and refund requests.',
        rationale: 'Safe retries prevent duplicate labels and duplicate refunds when a provider times out.',
        category: 'security',
      },
      {
        text: 'Define a measurable refund service level with owner, timer start, and escalation path.',
        rationale: 'The current five-business-day target is informal and cannot be monitored consistently.',
        category: 'testability',
      },
      {
        text: 'Keep an immutable audit trail for inspection decisions and supervisor overrides.',
        rationale: 'Finance needs the original decision, actor, reason, and evidence when a refund is disputed.',
        category: 'compliance',
      },
    ].map((item, index) => ({
      id: newId('rec'),
      projectId: project.id,
      key: `REC-${String(index + 1).padStart(3, '0')}`,
      ...item,
      category: item.category as Recommendation['category'],
      raisedBySessionId: session.id,
      status: 'open',
      dispositionNote: null,
      createdAt,
    }))
    insertRecommendations(db, recommendations)
    setSessionStatus(db, session.id, 'awaiting-review')

    db.prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
      .run(DEMO_MARKER_KEY, project.id)
    return project.id
  })()
}
