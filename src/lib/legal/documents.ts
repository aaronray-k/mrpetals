/**
 * The legal documents. PLACEHOLDER TEXT, PENDING LEGAL REVIEW: replace with the reviewed wording.
 *
 * Changing a document that people agree to: change its text and `version` here AND the version in
 * public.legal_documents (a new migration: `update legal_documents set version = '…' where code = '…'`).
 * Everyone it applies to is then asked to agree again at their next sign-in.
 */

export type LegalCode = 'terms-of-sale' | 'supplier-terms' | 'terms-of-use' | 'privacy' | 'cookies' | 'claims'

export interface LegalSection {
  heading: string
  body: (string | string[])[] // a string is a paragraph; an array is a bulleted list
}

export interface LegalDocument {
  code: LegalCode
  title: string
  version: string
  /** Who it is for, in a few words (shown on the public page). */
  audience: string
  summary: string
  sections: LegalSection[]
}

const VERSION = '2026-10-07'
const CONTACT = 'legal@consolflora.com (to be confirmed)'

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    code: 'terms-of-sale',
    title: 'Terms of sale',
    version: VERSION,
    audience: 'Buyers',
    summary: 'How ConsolFlora sells flowers to buyers: orders, prices, payment, shipping and claims.',
    sections: [
      {
        heading: '1. Who we are and what these terms cover',
        body: [
          'ConsolFlora consolidates fresh-cut flowers from farms in Kenya and ships them to buyers. These terms apply to every order a buyer places with ConsolFlora, in the ConsolFlora app or otherwise, including standing orders.',
          'By agreeing, the person signing in confirms they may act for the buyer\'s business.',
        ],
      },
      {
        heading: '2. Orders',
        body: [
          'An order is an offer to buy. It becomes binding when ConsolFlora approves it. ConsolFlora may decline an order, for example when it is over the buyer\'s credit limit, and gives the reason.',
          'Orders must be placed at least the lead time shown in the app (currently 72 hours) before the ship date. Flights may change, particularly for new buyers; ConsolFlora tells the buyer of any change.',
          'Standing orders repeat on the chosen days until the buyer changes or stops them. Each week\'s order is created five days before it ships; changes made after that apply from the following week, unless ConsolFlora agrees otherwise.',
          'ConsolFlora takes responsibility for supplying the confirmed quantity, from one or more farms.',
        ],
      },
      {
        heading: '3. Prices and currency',
        body: [
          'Prices are per stem, in the buyer\'s currency, for the buyer\'s incoterm, as shown when the order is placed. The price on the order is fixed once placed. Other charges (for example consolidation fees or data loggers) are shown on the proforma invoice.',
        ],
      },
      {
        heading: '4. Payment',
        body: [
          'Prepaid buyers pay before the shipment is released. Credit buyers pay within their agreed payment terms and credit limit. ConsolFlora may hold shipments for overdue amounts.',
        ],
      },
      {
        heading: '5. Delivery and risk',
        body: [
          'Delivery, risk and costs pass according to the incoterm on the order (for example FOB Nairobi or CPT destination airport). Export documents (phytosanitary certificate, certificate of origin) are supplied with each shipment.',
        ],
      },
      {
        heading: '6. Quality and claims',
        body: [
          'Flowers are supplied to the agreed grade and specification. Quality claims are handled under the Claims and credits policy, which forms part of these terms.',
        ],
      },
      {
        heading: '7. Liability',
        body: [
          'To the extent the law allows, ConsolFlora\'s liability for an order is limited to the price of the affected flowers, and ConsolFlora is not liable for indirect losses or delays caused by airlines, customs or events outside its control. [Wording pending legal review.]',
        ],
      },
      {
        heading: '8. Law and contact',
        body: [`These terms are governed by the laws of Kenya. [Pending legal review.] Questions: ${CONTACT}.`],
      },
    ],
  },
  {
    code: 'supplier-terms',
    title: 'Supplier terms',
    version: VERSION,
    audience: 'Farms and growers',
    summary: 'What ConsolFlora expects from farms that supply it, including quality, claims and costs.',
    sections: [
      {
        heading: '1. Purchase orders',
        body: [
          'ConsolFlora sends purchase orders with a specification for each line: variety, stem length, grade, stems per bunch, bunches per box, packing, sleeves and labels, and any buyer requirements.',
          'Review the specification before confirming. Confirming a line, in full or in part, means you have understood it and can meet it. If something is unclear or cannot be met, say so before confirming.',
          'Deliver the confirmed quantity to ConsolFlora by the delivery date on the order (normally 48 hours before the flight). Tell ConsolFlora at once of any shortage, quality problem or substitution; unapproved substitutions may be rejected.',
        ],
      },
      {
        heading: '2. Quality',
        body: [
          'Flowers must meet the agreed A1 standard and the specification, and be free from pests and disease. Check before dispatch, paying particular attention to:',
          ['Pests and insects', 'Disease, fungal infection and botrytis', 'Physical damage', 'Stem quality, length and strength', 'Flower and bud development, uniformity and colour', 'Foliage', 'Grading, packing, labelling and quantity'],
          'ConsolFlora checks boxes on arrival. A box may pass, pass with a minor note, fail and be fixed at ConsolFlora, or be returned to you with a BACK TO FARM sticker. Pests always mean the box is returned. ConsolFlora\'s checks do not remove your responsibility for the flowers you supply.',
        ],
      },
      {
        heading: '3. Claims from buyers',
        body: [
          'Buyers can only inspect flowers after arrival, customs clearance and unpacking, so claims may reach ConsolFlora about five days after departure. This is not a delay or a waiver.',
          'A claim states the reason, the quantity, the value, photographs and any additional costs. Where it is attributable to your flowers, the product value and directly related costs may be charged to you. You may be asked for information, and are expected to help find the cause.',
        ],
      },
      {
        heading: '4. Pests and fumigation',
        body: [
          'Some markets, including Japan, have zero tolerance for pests. Where pests in your flowers lead to fumigation or other mandatory treatment, the cost is charged to you (indicatively USD 350 to 500 per fumigation), together with any directly related inspection, disposal, storage or handling costs.',
        ],
      },
      {
        heading: '5. Repeated problems',
        body: [
          'Where problems repeat, ConsolFlora may ask for a corrective action plan or extra checks, change order quantities, suspend varieties or grades, or pause orders.',
        ],
      },
      {
        heading: '6. Payment and contact',
        body: [`ConsolFlora pays for confirmed, accepted flowers on the payment terms agreed with your farm. These terms are governed by the laws of Kenya. [Pending legal review.] Questions: ${CONTACT}.`],
      },
    ],
  },
  {
    code: 'terms-of-use',
    title: 'Terms of use for ConsolFlora staff',
    version: VERSION,
    audience: 'ConsolFlora staff',
    summary: 'How ConsolFlora staff use the app and the business information in it.',
    sections: [
      {
        heading: '1. Your account',
        body: ['Your account is personal. Do not share your password. Tell an Admin at once if you think someone else has used your account.'],
      },
      {
        heading: '2. Business information',
        body: [
          'Prices, margins, farm costs, buyer details and orders are confidential. Use them only for ConsolFlora\'s work, and do not share farm prices with buyers or buyer prices with farms.',
          'Keep records accurate: quality results, photos, payments and approvals are relied on by buyers, farms and finance.',
        ],
      },
      {
        heading: '3. Personal information',
        body: ['Handle people\'s contact details as described in the Privacy notice. Collect only business contact details: never ID numbers or dates of birth.'],
      },
      {
        heading: '4. Contact',
        body: [`Questions: ${CONTACT}. [Pending legal review.]`],
      },
    ],
  },
  {
    code: 'privacy',
    title: 'Privacy notice',
    version: VERSION,
    audience: 'Everyone who uses ConsolFlora',
    summary: 'What personal information ConsolFlora keeps, why, who sees it and your rights.',
    sections: [
      {
        heading: '1. Who is responsible',
        body: [`ConsolFlora (Kenya) is responsible for the personal information in the app. Contact: ${CONTACT}.`],
      },
      {
        heading: '2. What we keep',
        body: [
          'Only business contact details:',
          ['Your name, business email address and business phone number', 'The company you work for and your role in the app', 'What you do in the app (orders, confirmations, quality checks, approvals) and when', 'Photos of boxes taken during quality checks'],
          'We do not ask for ID numbers or dates of birth.',
        ],
      },
      {
        heading: '3. Why',
        body: ['To take and fulfil orders, pay and be paid, check quality and handle claims, meet export rules, and keep the app secure. Marketing emails are sent only if you choose them, and you can stop them at any time in My account.'],
      },
      {
        heading: '4. Who sees it',
        body: [
          'ConsolFlora staff who need it; the farms and buyers on the same orders, as far as needed; airlines, freight agents and authorities for shipments; and the service providers that run the app and email (hosting, database and email providers), under contract.',
          'Farms never see buyers\' prices, and buyers never see farms\' prices.',
        ],
      },
      {
        heading: '5. How long',
        body: ['For as long as you have an account, then as long as needed for accounting, tax and claims records. [Retention periods pending legal review.]'],
      },
      {
        heading: '6. Your rights',
        body: ['Under the Kenya Data Protection Act 2019 (and the GDPR for buyers in the EU) you can ask to see, correct or delete your information, or object to its use. Contact us at the address above. You can also complain to the Office of the Data Protection Commissioner.'],
      },
    ],
  },
  {
    code: 'cookies',
    title: 'Cookie notice',
    version: VERSION,
    audience: 'Everyone who uses ConsolFlora',
    summary: 'What the app stores in your browser.',
    sections: [
      {
        heading: 'What the app stores',
        body: [
          'The app uses only what it needs to work. It stores in your browser:',
          ['Your sign-in session, so you stay signed in', 'Your choices: tips on or off, the dashboard period, your cart before checkout, and scans waiting to be sent when the connection drops'],
          'There are no advertising or analytics cookies, and nothing is shared with advertisers. Because these are needed for the app to work, they cannot be switched off; clearing your browser data signs you out and empties the cart.',
        ],
      },
    ],
  },
  {
    code: 'claims',
    title: 'Claims and credits policy',
    version: VERSION,
    audience: 'Buyers (part of the Terms of sale)',
    summary: 'How buyers report quality problems and how credits are given.',
    sections: [
      {
        heading: '1. Reporting a problem',
        body: [
          'Report quality problems as soon as possible after the flowers arrive, and no later than [48 hours, pending legal review] after arrival. Include:',
          ['The box ID from the label (or scan its QR code)', 'What is wrong, and how many stems, bunches or boxes', 'Clear photographs of the flowers and the box label', 'Any additional costs, such as fumigation or disposal'],
        ],
      },
      {
        heading: '2. How claims are reviewed',
        body: [
          'ConsolFlora reviews each claim against the order, the specification, its own quality checks and photos taken before the flight, and the shipment details. ConsolFlora may ask for more information.',
        ],
      },
      {
        heading: '3. Credits',
        body: [
          'Accepted claims are settled with a credit note in the buyer\'s currency against future invoices, or a refund where agreed. The credit covers the value of the affected flowers and agreed directly related costs.',
        ],
      },
      {
        heading: '4. What is not covered',
        body: ['Problems caused after delivery under the incoterm (for example storage or handling at the buyer\'s premises), or reported without the information above. [Pending legal review.]'],
      },
    ],
  },
]

export const legalDocument = (code: string) => LEGAL_DOCUMENTS.find((d) => d.code === code)

/** Footer order. */
export const FOOTER_LINKS: { code: LegalCode; label: string }[] = [
  { code: 'privacy', label: 'Privacy notice' },
  { code: 'cookies', label: 'Cookie notice' },
  { code: 'terms-of-sale', label: 'Terms of sale' },
  { code: 'claims', label: 'Claims and credits' },
  { code: 'supplier-terms', label: 'Supplier terms' },
  { code: 'terms-of-use', label: 'Staff terms of use' },
]
