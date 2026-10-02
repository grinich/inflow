# Inflow UI port

Source: grinich/inflow, commit 52ed7d6b54b093d002ab45586cec80210ac61fbd, MIT (vendor/INFLOW-LICENSE).

ConversationRow, GroupAvatar, MessageBubble, EmojiAutocomplete, model types,
search/emoji helpers, URL validation, edge clamping, and global.css originate
from the upstream source tree. Imports use relative ESM paths. Rows gained
keyboard activation. Quoted-reply actions are hidden because the upstream MCP
only accepts plain-text sends.

The hooks, small UI store, and SharedPostCard fallback are MCP adapters, not
upstream implementations. Private media URLs are not in the upstream MCP
summaries; media remains a label linking the user conceptually to original
Inflow. No Chrome APIs, IndexedDB, or image proxy run in this widget.

The parent view adapts the original header, two-pane layout and text composer.
It uses the original components above for the actual rows and message bubbles.
Chrome-only network/composer/AI setup features remain available via the original
app or existing MCP tools, not as inert controls in the widget.
