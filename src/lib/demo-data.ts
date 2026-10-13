import type { ConnectionRole } from '@/types/connection';
// ---------------------------------------------------------------------------
// Demo mode — hardcoded realistic content
// ---------------------------------------------------------------------------

// Bundled portraits in public/demo/ — no network dependency.
function pic(file: string): string {
  try {
    return chrome.runtime.getURL(`demo/${file}`);
  } catch {
    return '';
  }
}

export const DEMO_PEOPLE = [
  { firstName: 'Sarah', lastName: 'Chen', picture: pic('w44.jpg') },
  { firstName: 'Marcus', lastName: 'Rivera', picture: pic('m32.jpg') },
  { firstName: 'Priya', lastName: 'Sharma', picture: pic('w68.jpg') },
  { firstName: 'James', lastName: 'O\'Brien', picture: pic('m75.jpg') },
  { firstName: 'Aisha', lastName: 'Patel', picture: pic('w21.jpg') },
  { firstName: 'Daniel', lastName: 'Kim', picture: pic('m45.jpg') },
  { firstName: 'Emma', lastName: 'Larsson', picture: pic('w17.jpg') },
  { firstName: 'Carlos', lastName: 'Mendez', picture: pic('m52.jpg') },
  { firstName: 'Yuki', lastName: 'Tanaka', picture: pic('w56.jpg') },
  { firstName: 'Rachel', lastName: 'Foster', picture: pic('w90.jpg') },
  { firstName: 'Omar', lastName: 'Hassan', picture: pic('m22.jpg') },
  { firstName: 'Lisa', lastName: 'Zhang', picture: pic('w33.jpg') },
  { firstName: 'Ryan', lastName: 'McCarthy', picture: pic('m11.jpg') },
  { firstName: 'Nina', lastName: 'Petrov', picture: pic('w49.jpg') },
  { firstName: 'Alex', lastName: 'Nguyen', picture: pic('m64.jpg') },
  { firstName: 'Sophie', lastName: 'Martin', picture: pic('w8.jpg') },
  { firstName: 'David', lastName: 'Park', picture: pic('m36.jpg') },
  { firstName: 'Maria', lastName: 'Gonzalez', picture: pic('w72.jpg') },
  { firstName: 'Thomas', lastName: 'Anderson', picture: pic('m3.jpg') },
  { firstName: 'Fatima', lastName: 'Al-Rashid', picture: pic('w85.jpg') },
  { firstName: 'Jake', lastName: 'Wilson', picture: pic('m18.jpg') },
  { firstName: 'Chloe', lastName: 'Dubois', picture: pic('w61.jpg') },
  { firstName: 'Raj', lastName: 'Kapoor', picture: pic('m87.jpg') },
  { firstName: 'Hannah', lastName: 'Brooks', picture: pic('w25.jpg') },
  { firstName: 'Kevin', lastName: 'Wu', picture: pic('m71.jpg') },
  { firstName: 'Elena', lastName: 'Volkov', picture: pic('w41.jpg') },
  { firstName: 'Sam', lastName: 'Taylor', picture: pic('m29.jpg') },
  { firstName: 'Mei', lastName: 'Lin', picture: pic('w14.jpg') },
  { firstName: 'Patrick', lastName: 'Byrne', picture: pic('m55.jpg') },
  { firstName: 'Zara', lastName: 'Johnson', picture: pic('w37.jpg') },
] as const;

export const DEMO_MESSAGES_INBOUND = [
  'Hey! Would love to chat about what you\'re building. Saw your recent post and it really resonated with me.',
  'Thanks for connecting! I\'ve been following your work for a while and think there could be some interesting synergies.',
  'Quick question — are you going to be at the conference next month? Would be great to meet in person.',
  'Just wanted to reach out. We\'re working on something similar and I think we could learn a lot from each other.',
  'Hope you\'re doing well! I noticed we have a few mutual connections and thought I\'d reach out.',
  'Really impressive product launch. Congrats! How did you approach the go-to-market strategy?',
  'I\'d love to get your thoughts on our latest feature release. Would you have 15 minutes this week?',
  'Following up on our conversation from the event. Still interested in exploring that partnership idea.',
  'Hey, a recruiter at our company is looking for someone with your background. Mind if I make an intro?',
  'Saw you\'re hiring! I know someone who would be perfect for the role. Want me to send their profile over?',
  'Just published a blog post that I think you\'d find relevant. Happy to share the link.',
  'We\'re hosting a small dinner next Thursday for founders in the space. Would you like to join?',
  'Curious if you\'ve tried the new API updates. We\'re seeing some interesting results on our end.',
  'Great talk at the meetup last week! Your perspective on developer tooling was spot on.',
  'Would love to pick your brain about scaling engineering teams. Going through that phase right now.',
  'We just closed our Series B and are looking to partner with companies like yours. Worth a conversation?',
  'Happy to help if you ever need any advice on the infrastructure side. Been through something similar.',
  'Any chance you\'re free for coffee next week? I\'m going to be in your area.',
  'Thought of you when I saw this opportunity. Might be a great fit for what you\'re working on.',
  'Really enjoyed your newsletter this week. The section on AI tooling was particularly insightful.',
];

/**
 * Who each demo person is, index-aligned with DEMO_PEOPLE above.
 *
 * Real inflow derives these from an AI pass over the connection list. Demo
 * mode ships them so the Connections and Insights sections have something to
 * show without a key, a sync, or anyone's real network on screen.
 *
 * The role mix is deliberately lopsided — Engineering dominates, Design and
 * Marketing are thin — because an evenly split pie chart tells you nothing
 * about what a real network looks like.
 */
export interface DemoProfile {
  headline: string;
  company: string;
  role: ConnectionRole;
  tags: string[];
  summary: string;
}

export const DEMO_PROFILES: DemoProfile[] = [
  { headline: 'Staff Engineer at Northwind', company: 'Northwind', role: 'Engineering', tags: [], summary: 'Works on payments infrastructure; we talked about idempotency keys.' },
  { headline: 'Partner at Fernbank Capital', company: 'Fernbank Capital', role: 'Investor', tags: ['Investor'], summary: 'Early-stage infrastructure investor. Asked to be kept posted on traction.' },
  { headline: 'Head of Product at Lumen', company: 'Lumen', role: 'Product', tags: [], summary: 'Running Lumen’s onboarding rewrite.' },
  { headline: 'Co-founder & CEO at Tidepool Labs', company: 'Tidepool Labs', role: 'Founder', tags: ['Founder'], summary: 'Second-time founder. Building developer tooling.' },
  { headline: 'Director of Engineering at Castellan', company: 'Castellan', role: 'Engineering', tags: [], summary: 'Manages three platform teams.' },
  { headline: 'Technical Recruiter at Castellan', company: 'Castellan', role: 'Recruiting', tags: [], summary: 'Reached out about a staff role last spring.' },
  { headline: 'VP Operations at Meridian Health', company: 'Meridian Health', role: 'Operations', tags: ['Healthcare'], summary: 'Owns revenue operations for a multi-site clinic group.' },
  { headline: 'Founder at Ascent Billing', company: 'Ascent Billing', role: 'Founder', tags: ['Founder', 'Healthcare'], summary: 'Runs a medical billing group in Ohio.' },
  { headline: 'Senior Designer at Lumen', company: 'Lumen', role: 'Design', tags: [], summary: 'Design systems. Shared a talk on density.' },
  { headline: 'CFO at Meridian Health', company: 'Meridian Health', role: 'Executive', tags: ['CFO', 'Healthcare'], summary: 'Evaluating revenue cycle tooling this fiscal year.' },
  { headline: 'Software Engineer at Northwind', company: 'Northwind', role: 'Engineering', tags: [], summary: 'Backend, mostly Go.' },
  { headline: 'Head of Sales at Tidepool Labs', company: 'Tidepool Labs', role: 'Sales & BD', tags: [], summary: 'Built Tidepool’s first sales motion.' },
  { headline: 'Engineering Manager at Castellan', company: 'Castellan', role: 'Engineering', tags: [], summary: 'Was a staff engineer before moving to management.' },
  { headline: 'Principal at Fernbank Capital', company: 'Fernbank Capital', role: 'Investor', tags: ['Investor'], summary: 'Covers healthcare IT for Fernbank.' },
  { headline: 'Staff Engineer at Lumen', company: 'Lumen', role: 'Engineering', tags: [], summary: 'Works on the editor team.' },
  { headline: 'Chief of Staff at Meridian Health', company: 'Meridian Health', role: 'Executive', tags: ['Healthcare'], summary: 'Coordinates the clinical ops leadership team.' },
  { headline: 'Founder at Harbor Analytics', company: 'Harbor Analytics', role: 'Founder', tags: ['Founder'], summary: 'Bootstrapped; profitable since year two.' },
  { headline: 'Billing Operations Manager at Ascent Billing', company: 'Ascent Billing', role: 'Operations', tags: ['Healthcare'], summary: 'Runs a team of twelve billers.' },
  { headline: 'Infrastructure Engineer at Northwind', company: 'Northwind', role: 'Engineering', tags: [], summary: 'On call for the database fleet.' },
  { headline: 'Head of People at Castellan', company: 'Castellan', role: 'Recruiting', tags: [], summary: 'Scaling Castellan from 40 to 120.' },
  { headline: 'Account Executive at Harbor Analytics', company: 'Harbor Analytics', role: 'Sales & BD', tags: [], summary: 'Sells into mid-market finance teams.' },
  { headline: 'Product Designer at Tidepool Labs', company: 'Tidepool Labs', role: 'Design', tags: [], summary: 'Works across the whole product.' },
  { headline: 'CTO at Ascent Billing', company: 'Ascent Billing', role: 'Executive', tags: ['Healthcare'], summary: 'Chose their clearinghouse integration.' },
  { headline: 'Growth Marketer at Lumen', company: 'Lumen', role: 'Marketing', tags: [], summary: 'Owns lifecycle email.' },
  { headline: 'Senior Engineer at Harbor Analytics', company: 'Harbor Analytics', role: 'Engineering', tags: [], summary: 'Query engine internals.' },
  { headline: 'Managing Director at Fernbank Capital', company: 'Fernbank Capital', role: 'Investor', tags: ['Investor'], summary: 'Led Fernbank’s last healthcare fund.' },
  { headline: 'Operations Lead at Northwind', company: 'Northwind', role: 'Operations', tags: [], summary: 'Keeps the release process honest.' },
  { headline: 'Physician and Advisor at Meridian Health', company: 'Meridian Health', role: 'Executive', tags: ['Physician', 'Healthcare'], summary: 'Practising physician; advises on clinical workflow.' },
  { headline: 'Co-founder at Harbor Analytics', company: 'Harbor Analytics', role: 'Founder', tags: ['Founder'], summary: 'Handles the commercial side.' },
  { headline: 'Product Manager at Castellan', company: 'Castellan', role: 'Product', tags: [], summary: 'Owns the integrations roadmap.' },
];


export const DEMO_MESSAGES_OUTBOUND = [
  'Thanks for reaching out! Would love to connect. How about next Tuesday?',
  'Great to hear from you. Let me check my calendar and get back to you.',
  'That sounds really interesting. Can you share more details about the project?',
  'Appreciate the kind words! Happy to chat more about our approach.',
  'Yes, I\'ll be there! Let\'s definitely plan to meet up.',
  'Thanks for thinking of me. I\'d be happy to take a look.',
  'Sounds like a great opportunity. Let me discuss with my team and circle back.',
  'Really appreciate the intro offer. That would be super helpful.',
  'Good question. We approached it by focusing on the developer experience first.',
  'I\'d love to learn more about what you\'re building. Send over some details?',
  'That\'s a great point. We\'ve been thinking along similar lines.',
  'Thanks! It was a team effort. Happy to share some lessons learned.',
  'Let me know when works for you. I\'m pretty flexible this week.',
  'Just saw this — really cool work. Congrats on the launch!',
  'Definitely interested. Let\'s set up a proper call to discuss.',
];

export const DEMO_OPENERS = [
  'Hi! I came across your profile and was really impressed by your work. Would love to connect and learn more about what you\'re building.',
  'Hey there! We met briefly at the tech meetup last month. I\'ve been thinking about what you mentioned and wanted to follow up.',
  'Hi! I noticed we\'re both working in the developer tools space. Would love to exchange ideas sometime.',
  'Hello! A mutual friend suggested I reach out to you. I think there might be some interesting overlap in what we\'re both working on.',
  'Hey! Just wanted to say your recent article was really thought-provoking. Would love to discuss some of the ideas you raised.',
  'Hi there! I\'m reaching out because I think our companies could really benefit from working together. Do you have time for a quick chat this week?',
  'Hey! Congrats on the recent funding round. I\'d love to hear more about your plans and see if there\'s a way we can help.',
  'Hi! I saw your talk at the conference and it really stuck with me. Would love to continue the conversation.',
];
