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
  { firstName: 'Sarah', lastName: 'Chen', company: 'Stripe', title: 'Head of Partnerships', picture: pic('w44.jpg') },
  { firstName: 'Marcus', lastName: 'Rivera', company: 'Figma', title: 'Senior Product Designer', picture: pic('m32.jpg') },
  { firstName: 'Priya', lastName: 'Sharma', company: 'Notion', title: 'Engineering Manager', picture: pic('w68.jpg') },
  { firstName: 'James', lastName: 'O\'Brien', company: 'Vercel', title: 'Solutions Architect', picture: pic('m75.jpg') },
  { firstName: 'Aisha', lastName: 'Patel', company: 'Linear', title: 'Founding Engineer', picture: pic('w21.jpg') },
  { firstName: 'Daniel', lastName: 'Kim', company: 'Retool', title: 'VP of Sales', picture: pic('m45.jpg') },
  { firstName: 'Emma', lastName: 'Larsson', company: 'Klarna', title: 'Product Manager', picture: pic('w17.jpg') },
  { firstName: 'Carlos', lastName: 'Mendez', company: 'Ramp', title: 'Growth Lead', picture: pic('m52.jpg') },
  { firstName: 'Yuki', lastName: 'Tanaka', company: 'Mercari', title: 'Staff Engineer', picture: pic('w56.jpg') },
  { firstName: 'Rachel', lastName: 'Foster', company: 'Plaid', title: 'Head of Developer Relations', picture: pic('w90.jpg') },
  { firstName: 'Omar', lastName: 'Hassan', company: 'Databricks', title: 'Data Science Lead', picture: pic('m22.jpg') },
  { firstName: 'Lisa', lastName: 'Zhang', company: 'Anthropic', title: 'Research Scientist', picture: pic('w33.jpg') },
  { firstName: 'Ryan', lastName: 'McCarthy', company: 'Coinbase', title: 'Engineering Director', picture: pic('m11.jpg') },
  { firstName: 'Nina', lastName: 'Petrov', company: 'Miro', title: 'UX Research Lead', picture: pic('w49.jpg') },
  { firstName: 'Alex', lastName: 'Nguyen', company: 'Supabase', title: 'Developer Advocate', picture: pic('m64.jpg') },
  { firstName: 'Sophie', lastName: 'Martin', company: 'Datadog', title: 'Site Reliability Engineer', picture: pic('w8.jpg') },
  { firstName: 'David', lastName: 'Park', company: 'Airtable', title: 'Product Lead', picture: pic('m36.jpg') },
  { firstName: 'Maria', lastName: 'Gonzalez', company: 'Canva', title: 'Creative Director', picture: pic('w72.jpg') },
  { firstName: 'Thomas', lastName: 'Anderson', company: 'MongoDB', title: 'Principal Architect', picture: pic('m3.jpg') },
  { firstName: 'Fatima', lastName: 'Al-Rashid', company: 'Wise', title: 'Head of Compliance', picture: pic('w85.jpg') },
  { firstName: 'Jake', lastName: 'Wilson', company: 'Loom', title: 'Customer Success Manager', picture: pic('m18.jpg') },
  { firstName: 'Chloe', lastName: 'Dubois', company: 'Algolia', title: 'Search Engineer', picture: pic('w61.jpg') },
  { firstName: 'Raj', lastName: 'Kapoor', company: 'Freshworks', title: 'VP of Engineering', picture: pic('m87.jpg') },
  { firstName: 'Hannah', lastName: 'Brooks', company: 'Zapier', title: 'Automation Specialist', picture: pic('w25.jpg') },
  { firstName: 'Kevin', lastName: 'Wu', company: 'Scale AI', title: 'ML Engineer', picture: pic('m71.jpg') },
  { firstName: 'Elena', lastName: 'Volkov', company: 'JetBrains', title: 'IDE Developer', picture: pic('w41.jpg') },
  { firstName: 'Sam', lastName: 'Taylor', company: 'Webflow', title: 'Design Systems Lead', picture: pic('m29.jpg') },
  { firstName: 'Mei', lastName: 'Lin', company: 'TikTok', title: 'Ads Product Manager', picture: pic('w14.jpg') },
  { firstName: 'Patrick', lastName: 'Byrne', company: 'Intercom', title: 'Support Engineering Lead', picture: pic('m55.jpg') },
  { firstName: 'Zara', lastName: 'Johnson', company: 'Amplitude', title: 'Analytics Lead', picture: pic('w37.jpg') },
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
