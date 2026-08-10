// Bundles the repo's CHANGELOG.md into the extension so the "What's new" modal
// can show release notes offline. Isolated in its own module so tests can mock
// the raw import.
import changelogText from '../../CHANGELOG.md?raw';

export const CHANGELOG_TEXT: string = changelogText;
