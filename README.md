# Telefast

A small, frontend-only Telegram client focused on private and group text chats.

## Current scope

- Phone-number authentication
- Telegram login codes and two-step verification
- Persistent IndexedDB sessions
- Private and group chat list with unread counts
- User and group avatars with initials as a fallback
- URL-based chat navigation with browser history and deep links
- Paginated message history
- Real-time incoming messages
- Opt-in desktop notifications for unmuted private and group chats
- Sending text messages
- Static, animated, and video sticker display

## Run locally

1. Create a Telegram application at <https://my.telegram.org/apps>.
2. Install dependencies and start Vite:

   ```sh
   pnpm install
   pnpm dev
   ```

3. Open the shown local URL. Enter the application's API ID and API hash, then your phone number.

The API credentials are stored in local storage. mtcute stores the Telegram session in IndexedDB and runs MTProto in a Web Worker. Do not use this client on an untrusted device or host.

## Build

```sh
pnpm build
```

Deployments must route `/login` and `/chat/*` requests to `index.html` so deep links can load the SPA.
