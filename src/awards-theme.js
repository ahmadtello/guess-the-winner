// Editable guest-facing text and appearance. Hosts override these from Game settings;
// anything left empty falls back to the defaults below.
export const TEXT_FIELDS = [
  { key: 'joinTitle', group: 'Join screen', label: 'Headline', default: 'A night of excellence.\nYour winning guesses.', multiline: true },
  { key: 'joinIntro', group: 'Join screen', label: 'Introduction', default: 'Choose who you think will take home the awards.' },
  { key: 'joinNameLabel', group: 'Join screen', label: 'Name field label', default: 'Enter the name of the table representative' },
  { key: 'joinNamePlaceholder', group: 'Join screen', label: 'Name field placeholder', default: 'Table representative’s full name' },
  { key: 'joinTableLabel', group: 'Join screen', label: 'Table field label', default: 'Table number' },
  { key: 'joinTablePlaceholder', group: 'Join screen', label: 'Table field placeholder', default: 'Enter your table number' },
  { key: 'joinButton', group: 'Join screen', label: 'Join button', default: 'Join the game' },
  { key: 'joinButtonBusy', group: 'Join screen', label: 'Join button while joining', default: 'Joining…' },
  { key: 'joinNote', group: 'Join screen', label: 'Note under the button', default: 'Your selections are saved securely for this game.' },
  { key: 'greeting', group: 'Game screen', label: 'Greeting bar', default: 'Hello, {name}' },
  { key: 'tableLabel', group: 'Game screen', label: 'Table label', default: 'Table {table}' },
  { key: 'roundLabel', group: 'Game screen', label: 'Round label', default: 'Round {round} of {rounds}' },
  { key: 'roundQuestions', group: 'Game screen', label: 'Round question count', default: '{total} questions' },
  { key: 'roundMessage', group: 'Game screen', label: 'Round introduction message', default: 'The host will start this round shortly.', multiline: true },
  { key: 'questionLabel', group: 'Game screen', label: 'Question counter', default: 'Question {question} of {total}' },
  { key: 'statusWaiting', group: 'Game screen', label: 'Status before a question starts', default: 'Starting soon' },
  { key: 'statusClosed', group: 'Game screen', label: 'Status after a question ends', default: 'Question closed' },
  { key: 'ballotTitle', group: 'Game screen', label: 'Ballot title', default: 'Guess the Winner' },
  { key: 'categoryStart', group: 'Game screen', label: 'Banner when a question starts', default: 'Category starts now' },
  { key: 'instructionWaiting', group: 'Messages', label: 'Before the question starts', default: 'Get ready. Your host will start this question shortly.', multiline: true },
  { key: 'instructionClosed', group: 'Messages', label: 'After the question ends', default: 'This question has ended. Wait for your host to start the next question.', multiline: true },
  { key: 'noticeWaiting', group: 'Messages', label: 'Notice while waiting', default: 'Waiting for the question to start.' },
  { key: 'noticeChoose', group: 'Messages', label: 'Notice while a question is open', default: 'Please select your winner' },
  { key: 'noticeSaving', group: 'Messages', label: 'Notice while saving', default: 'Saving your selection…' },
  { key: 'noticeSaved', group: 'Messages', label: 'Notice after saving', default: 'Selection saved.' },
  { key: 'noticeSubmitted', group: 'Messages', label: 'After the question ends, answered', default: 'Your selection was submitted.' },
  { key: 'noticeNone', group: 'Messages', label: 'After the question ends, not answered', default: 'No selection was submitted for this question.' },
  { key: 'endKicker', group: 'End of game', label: 'Small heading', default: 'Guess the Winner' },
  { key: 'endTitle', group: 'End of game', label: 'Title', default: 'That’s a wrap!' },
  { key: 'endMessage', group: 'End of game', label: 'Message', default: 'Thank you for playing, {name}. Your guesses are in and the winners will be revealed on stage.', multiline: true },
  { key: 'endNote', group: 'End of game', label: 'Closing line', default: 'Enjoy the rest of the evening.' },
  { key: 'footer', group: 'General', label: 'Footer', default: 'Guess the Winner' },
  { key: 'connected', group: 'General', label: 'Top bar when connected', default: 'Connected to the game' },
  { key: 'reconnecting', group: 'General', label: 'Top bar when reconnecting', default: 'Reconnecting — check your connection' },
  { key: 'logoAlt', group: 'General', label: 'Logo description for screen readers', default: 'Guess the Winner' },
];

export const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary (buttons, headings, greeting bar)', default: '#143522', cssVar: '--g-primary' },
  { key: 'accent', label: 'Accent (gold details)', default: '#9e8754', cssVar: '--g-accent' },
  { key: 'text', label: 'Text', default: '#202e27', cssVar: '--g-text' },
  { key: 'muted', label: 'Secondary text', default: '#677269', cssVar: '--g-muted' },
  { key: 'banner', label: 'Banner background', default: '#e5decd', cssVar: '--g-banner' },
  { key: 'bannerBorder', label: 'Banner border', default: '#c7b98f', cssVar: '--g-banner-border' },
  { key: 'page', label: 'Page background', default: '#e7e5d9', cssVar: '--g-page' },
  { key: 'card', label: 'Card background', default: '#ffffff', cssVar: '--g-card' },
  { key: 'selected', label: 'Selected company background', default: '#edf4e9', cssVar: '--g-selected' },
  { key: 'notice', label: 'Notice background', default: '#edf3ed', cssVar: '--g-notice' },
];

export const TEXT_GROUPS = [...new Set(TEXT_FIELDS.map((f) => f.group))];
export const PLACEHOLDERS = ['{name}', '{table}', '{round}', '{rounds}', '{question}', '{total}', '{category}'];
export const DEFAULT_LOGO = '/brand/logo.svg';
export const EMPTY_THEME = { texts: {}, colors: {}, logo: '' };
const DEFAULT_TEXTS = Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, f.default]));

export function themeText(theme, key, vars) {
  const custom = theme?.texts?.[key];
  const text = typeof custom === 'string' && custom.trim() ? custom : DEFAULT_TEXTS[key] || '';
  return text.replace(/\{(\w+)\}/g, (match, name) => (vars && vars[name] !== undefined && vars[name] !== '' ? String(vars[name]) : match));
}

export function themeStyle(theme) {
  return Object.fromEntries(COLOR_FIELDS.map((c) => [c.cssVar, /^#[0-9a-fA-F]{6}$/.test(theme?.colors?.[c.key] || '') ? theme.colors[c.key] : c.default]));
}

export function themeLogo(theme) {
  return theme?.logo || DEFAULT_LOGO;
}
