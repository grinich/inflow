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

export const DEMO_INVITATIONS = [
  { firstName: 'Noah', lastName: 'Bennett', headline: 'Founder at Driftwood Labs', picture: pic('m71.jpg'), message: 'Loved your talk on local-first apps — would be great to connect!', daysAgo: 0 , mutuals: ['Priya Raman', 'Tom Whitfield'], mutualCount: 14 },
  { firstName: 'Isabella', lastName: 'Moreau', headline: 'Engineering Recruiter at TalentBridge', picture: pic('w37.jpg'), message: '', daysAgo: 1 , mutuals: ['Priya Raman'], mutualCount: 3 },
  { firstName: 'Leo', lastName: 'Fischer', headline: 'CTO at Brightpath', picture: pic('m87.jpg'), message: 'We met at the React meetup last week. Let\'s stay in touch!', daysAgo: 2 , mutuals: [], mutualCount: 0 },
  { firstName: 'Amara', lastName: 'Okafor', headline: 'Product Designer at Northwind', picture: pic('w61.jpg'), message: '', daysAgo: 4 , mutuals: ['Dan Okonkwo', 'Sofia Marchetti'], mutualCount: 27 },
  { firstName: 'Hugo', lastName: 'Silva', headline: 'DevRel at CloudForge', picture: pic('m55.jpg'), message: 'Big fan of inflow — would love to compare notes on Voyager APIs.', daysAgo: 6 , mutuals: ['Tom Whitfield'], mutualCount: 5 },
] as const;

/** Outgoing requests still waiting on a reply, for the Sent tab. */
export const DEMO_SENT_INVITATIONS = [
  { firstName: 'Priya', lastName: 'Raman', headline: 'Head of Platform at Meridian', picture: pic('w49.jpg'), message: 'Enjoyed your write-up on keyboard-first UIs — would love to trade notes.', daysAgo: 2 },
  { firstName: 'Tom', lastName: 'Whitfield', headline: 'Principal Engineer at Halcyon', picture: pic('m8.jpg'), message: '', daysAgo: 5 },
  { firstName: 'Sofia', lastName: 'Marchetti', headline: 'Design Lead at Vantage', picture: pic('w41.jpg'), message: 'We both worked with Dan — thought it would be good to connect properly.', daysAgo: 11 },
] as const;

/**
 * First N DEMO_PEOPLE become demo connections, staggered over recent weeks.
 * DEMO_PEOPLE carry no headline (the inbox never shows one), so connections
 * take theirs from DEMO_CONNECTION_HEADLINES by index — the two lists must
 * stay the same length as DEMO_CONNECTION_COUNT.
 */
export const DEMO_CONNECTION_COUNT = 15;
export const DEMO_CONNECTION_DAY_GAPS = [0, 1, 1, 2, 3, 5, 7, 9, 12, 16, 21, 27, 34, 42, 55] as const;
export const DEMO_CONNECTION_HEADLINES = [
  'VP of Engineering at Lumen Analytics',
  'Staff Software Engineer at Orbital',
  'Head of Product at Kestrel Health',
  'Founder & CEO at Ridgeline Robotics',
  'Design Lead at Meridian Studio',
  'Senior Data Scientist at Halcyon AI',
  'Engineering Manager at Northwind',
  'Growth Marketing at Driftwood Labs',
  'Principal Engineer at Brightpath',
  'Partner at Seabright Ventures',
  'Developer Advocate at CloudForge',
  'Product Manager at Tidewater',
  'Chief Technology Officer at Alder Systems',
  'Security Researcher at Basalt',
  'Frontend Engineer at Pinecrest',
] as const;
