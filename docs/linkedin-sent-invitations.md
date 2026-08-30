# Sent invitations: where the data actually lives

Captured against a live account on 2026-08-30, after inflow's Sent tab shipped
against a Voyager endpoint that no longer exists.

## Voyager no longer serves this

Every plausible REST route, with a valid csrf token:

| request | result |
| --- | --- |
| `relationships/invitationViews?q=sentInvitation` | **400** |
| `relationships/invitationViews?q=sent` | 400 |
| `relationships/invitationViews?q=sentInvitationViews` | 400 |
| `relationships/invitations?q=sent` | 400 |
| `relationships/sentInvitationViews` | **404** |
| `relationships/dash/invitations?q=sent` | 404 |
| `relationships/dash/invitationViews?q=sent` | 404 |
| `relationships/invitationViews?q=receivedInvitation` | **200** ✅ |

Received still works, so the endpoint is alive and sent invitations have been
moved off it. Watching LinkedIn's own invitation manager confirms this from the
other side: switching Received → Sent fires **no Voyager request**, and neither
does withdrawing. It is all server-driven UI now.

Incidental finding worth keeping: the received endpoint reports
`paging.total: 0` on a page that returned 10 invitations. Anything treating
`total` as authoritative will truncate to nothing — which is why the
invitation walk only ever reads it in the direction of fetching *more*.

## Reading the list

Switching to the Sent tab issues:

```
POST https://www.linkedin.com/flagship-web/mynetwork/invitation-manager/sent
```

A plain `GET` of `/mynetwork/invitation-manager/sent/` returns the same thing:
~635 KB of HTML with the data embedded as escaped JSON, one object per row.

```json
{
  "title": "Withdraw invitation",
  "requestedArguments": {
    "$type": "proto.sdui.actions.requests.RequestedArguments",
    "payload": {
      "profileUrn": "ACoAA…",
      "queryName": "ProfileMemberRelationshipRefreshById",
      "trackingActionType": "INVITATION_MANAGER_WITHDRAW",
      "invitationType": 1,
      "inviterActionType": 2,
      "inviteeVanityName": "dillon-mulroy",
      "firstName": "Dillon",
      "lastName": "Mulroy",
      "cardRef": { "key": "auto-component-<uuid>" },
      "invitationUrn": { "invitationId": "7498810568384856065" }
    }
  }
}
```

So each row yields the invitation id, the profile urn, the public id
(`inviteeVanityName`) and the name. The total comes from the literal
`People (309)` in the same document.

**Not** present in that payload: `sharedSecret` (the received-invitation
accept/ignore calls need one; withdraw does not), the headline, the note, the
timestamp and the avatar.

Those live in the other half of the document, and reading the JSON island
alone is what produced a first version showing bare names against a LinkedIn
page showing everything:

- **headline, "Sent N ago", the note** — server-rendered markup. Per row the
  visible text runs `name → headline → Sent N ago → Withdraw → note`. The note
  comes *after* the button, so it trails its own row; read naively it attaches
  to the next person. Anchor on
  `aria-label="Withdraw invitation sent to <name>"`, never on class names.
- **avatar** — back in the JSON island, but in a separate envelope keyed by
  `a11yText` ("<name>, profile photo") with `rootUrl` +
  `imageRenditions[{width,height,suffixUrl}]`. Note `imageRenditions`, not
  Voyager's `artifacts`. Join to the row by name.

The timestamp is only ever a rounded relative phrase, so any absolute value
is an approximation of when the page was read.

Only the first 10 rows are in the document. The rest come from the same
pagination action the page's infinite scroll uses.

## Paging

```
POST https://www.linkedin.com/flagship-web/rsc-action/actions/pagination
     ?sduiid=com.linkedin.sdui.pagers.mynetwork.scribeSentInvitationManagerList
Content-Type: application/json
csrf-token: <JSESSIONID>
```

The cursor is a plain offset — `clientArguments.payload.invitationStartIndex`,
stepping 0, 10, 20 — inside a fixed envelope naming the pager, the screen and
the enums (`PendingInvitationDirection_SENT`,
`GenericInvitationType_CONNECTION`, `FilterCriteria_UNKNOWN`, phase
`Invitations`). LinkedIn's client sends nine headers; **csrf-token is the only
one the server requires**, the rest are tracking. Verified by replaying the
call with startIndex 200 and getting rows back.

The response is **not** HTML. It is an RSC component tree, and it differs from
page one in three ways that all matter to a parser:

- text sits in `"children":["…"]`, so tag-stripping returns nothing
- `aria-label` is a JSON key (`"aria-label":"…"`), not an HTML attribute
- the withdraw control is a deferred chunk reference (`$L34`), and **the note
  comes before it** — the reverse of the markup, where the note trails the
  button

There is no `People (N)` heading after page one, so the total is first-page
only. Stop on a short page, on a page that repeats what you have, or on
reaching the heading's total.

## Withdrawing

```
POST https://www.linkedin.com/flagship-web/rsc-action/actions/server-request
     ?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation
     &parentSpanId=<span>
Content-Type: application/json
```

Body, ~2.5 KB (captured by intercepting and blocking the real call, so no
second invitation was withdrawn):

```json
{
  "requestId": "com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation",
  "serverRequest": {
    "requestId": "com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation",
    "requestedArguments": {
      "$type": "proto.sdui.actions.requests.RequestedArguments",
      "requestedStateKeys": [
        { "key": { "value": { "$case": "id", "id": "guidedFlowNumSentInvites" } }, "namespace": "" },
        { "key": { "value": { "$case": "id", "id": "guidedFlowUrlAndPictureList" } },
          "namespace": "guidedFlowUrlAndPictureListNameSpace" }
      ],
      "payload": {
        "inviterActionType": "InviterActionType_WITHDRAW",
        "inviteeVanityName": "stevehamrick",
        "firstName": "Steve",
        "lastName": "Hamrick",
        "profileUrn": "ACoAA…",
        "queryName": "ProfileMemberRelationshipRefreshById",
        "invitationType": "GenericInvitationType_CONNECTION",
        "invitationUrn": { "invitationId": "7498…" },
        "firstFiveInviteCount": { "key": "guidedFlowNumSentInvites", "namespace": "" },
        "guidedFlowUrlandProfileList": {
          "key": "guidedFlowUrlAndPictureList",
          "namespace": "guidedFlowUrlAndPictureListNameSpace"
        }
      }
    }
  }
}
```

Note the enums are **strings** here (`"InviterActionType_WITHDRAW"`,
`"GenericInvitationType_CONNECTION"`) where the embedded list payload used
integers (`inviterActionType: 2`, `invitationType: 1`). A client has to
translate, not copy.

The UI confirms first ("you won't be able to resend to this person for up to
3 weeks"), and on success the count drops by one and a toast appears.

## What this costs

Everything here is a private, unversioned surface: hashed CSS class names, RSC
payload shapes, and `sduiid` strings that carry LinkedIn's internal package
paths. Voyager is undocumented too, but it is a versioned API with stable
finder names — this is a rendering pipeline, and it will break more often and
more silently.

Anything built on it should treat every field as optional, verify against a
live account rather than a mock (a mocked test cannot catch a dead endpoint —
that is exactly how the broken Sent tab shipped green), and degrade to an
explicit error rather than an empty list.
