# **TempChat: Mobile-First User Interaction Flows**

This document defines the user journey and interface requirements for TempChat, optimized for mobile browser and PWA usage. Technical details are maintained in the System Design document.

## **1. Room Management (Homepage / Dashboard)**

**Goal**: A central hub to manage active conversations on a single device.

1. **Dashboard View**: Upon opening the app, the user sees a "My Rooms" list.
   - **Active Rooms**: Displayed with the Room Name, a "live" countdown timer, and a "Join" button.
   - **Note on Expiration**: To maintain absolute privacy and zero-trace principles, rooms that have reached their expiration time are automatically removed from the Dashboard. No history or "Expired" logs are kept.

2. **Room Actions**:
   - **Join**: Clicking an active room card resumes the session immediately.
   - **Manual Leave**: A user can manually remove a room from their list, which wipes the local keys and metadata for that specific room from their device.

3. **Creation Trigger**:
   - **Empty State**: If the dashboard is empty, a prominent, centered "Hero" card appears with a large "Create Your First Room" button.
   - **Active State**: Once rooms exist, the primary trigger shifts to a Floating Action Button (FAB) with a "+" icon located in the bottom-right "thumb zone."

## **2. Room Initiation (Creation Screen)**

**Goal**: Quick, thumb-friendly room creation.

1. **Input**: A clean view with a large, mobile-optimized text input for **Room Name**.
2. **Action**: "Create Room" is a prominent bottom-anchored button.
3. **Transition**: Minimalist loading spinner. Upon success, the room is added to the Dashboard list immediately.
4. **Invitation Step**: Before entering the chat, a dedicated **Invitation Screen** appears displaying the **QR Code** and a "Share Link" button.
5. **Entry**: Once the user is done inviting, they tap "Go to Chat" to enter the **Chat Screen**.

## **3. Invitation & Onboarding (Mobile Join Flow)**

**Goal**: Zero-friction entry via physical proximity or social sharing.

### **The Inviter (Creator/Member)**

1. **Access**: Taps the "Invite" icon in the top header or accesses via the **Room Detail** view.
2. **Display**: A **Bottom Sheet** appears containing a high-contrast **QR Code** and a "Share Link" button.

### **The Joiner**

1. **Entry**: Scans QR via native camera or opens a shared link.
2. **Identity Prompt**: If space is available, a centered overlay asks for a **Display Name**.
3. **Action**: User types name and taps "Join Chat." The room is added to the Joiner's Dashboard.

**If the room is full (join returns 403):**

1. Client fetches `GET /v1/rooms/:roomId` (to get `memberCount` and `maxParticipants`) and `GET /v1/boost-options` in parallel.
2. **If any boost option has `maxParticipants > room.maxParticipants`:** Show a full-screen **"Room Is Full"** view with the room name and a list of applicable boost options as purchase cards.
3. **If no boost would raise the cap:** Show "This room is at maximum capacity." No boost options shown.
4. Tapping a boost option opens the payment flow. After successful payment and webhook confirmation, the room is boosted and the user is automatically joined.
5. **Edge case:** If the slot fills again before the join completes, show "Room filled up again — try again."

## **4. Real-Time Chatting (Mobile Chat UI)**

**Goal**: Familiar, high-performance messaging interface.

1. **Header**:
   - **Room Name (Interactive)**: Tapping the Room Name (left-side) or the "Info" icon (right-side) opens the **Room Detail** view.
   - **Left**: Back Arrow (returns to Dashboard).
   - **Right**: Participant Count (e.g., "👤 4/5").

2. **Room Detail View (Slide-over/Drawer)**:
   - **Information**: Displays the full Room Name and room status.
   - **Members List**: Shows the Display Names of all current participants in the room.
   - **Invite Action**: A prominent button that opens the **Invitation Bottom Sheet** (QR Code + Link).
   - **Danger Zone**: A "Leave & Delete Room" button. Tapping this removes the room from the user's Dashboard and wipes all local cryptographic keys for this room.
   - **Boost Room**: A "Boost Room" button that opens the Boost Bottom Sheet with current available options.

3. **Floating Status Pill**: A dynamic pill floats at the top of the chat area:
   - **Visuals**: Displays a micro-countdown (e.g., `1h 45m`) and a **Lightning Bolt** icon.
   - **Color States**: Healthy (Navy), Warning (Amber), Urgent (Pulsing Red).
   - **Interaction**: Tapping the pill expands it to show boost purchase options (fetched from `GET /v1/boost-options`), each displayed as a **Boost Option Card**. Both options are always shown — stacking is always useful for extending expiry even if the participant cap is already high.
   - **Post-boost**: On `room:boosted` WebSocket event, the pill animates briefly, the timer updates to the new `expiresAt`, and a system message appears in the chat feed (e.g., "Alice boosted this room (+7 days, up to 100 participants)." or "Someone outside boosted this room (+24 hours, up to 20 participants).").

4. **Message Feed**: Compact bubbles with "Self" vs "Others" distinction. Tapping a bubble reveals the server timestamp.
5. **Input Area**: Sticky at the bottom with an auto-expanding text area.

## **5. Room Boosting (In-App Monetization)**

**Goal**: Low-friction upgrades. **Note: Only available for Active Rooms.**

### **5.1 In-Room Boost (Member)**

- **Trigger**: Tapping the **Floating Status Pill** or the "Boost Room" button in the **Room Detail** overlay.
- **Flow**: Bottom Sheet shows boost options (fetched from `GET /v1/boost-options`) → user selects and pays (SePay / Paddle) → payment webhook confirms → server runs atomic boost script → `room:boosted` broadcast → pill timer and chat feed update for all members.

### **5.2 Out-of-Room Boost (Non-Member Entry Boost)**

- **Trigger**: Joining a full room (join returns `room_full` error).
- **Flow**: Client fetches room info + boost options → shows Room Full screen with applicable boost cards → user selects and pays → payment webhook confirms → server runs boost script → user is automatically joined into the room.

### **5.3 Boost Restrictions**

- All boost options are always purchasable regardless of current caps — stacking is always valid for expiry extension.
- Boost options that would not raise the participant cap above the room's current cap are **not shown** on the Room Full screen (they would not help the non-member join), but are still shown to in-room members (expiry extension is still useful).

## **6. Room Expiration & Persistence**

**Goal**: Immediate data destruction across the stack.

1. **Auto-Resume**: Returning users are identified via `localStorage` keys for active rooms.
2. **Warning**: At T-minus 1 hour, a persistent banner appears: "Closing soon. This space and all data will be permanently deleted."
3. **Post-Expiration**:
   - The server purges the Redis keys.
   - The client detects the expiration, wipes the room-specific `localStorage`, and the room disappears from the Dashboard.
   - Active users are redirected to the Dashboard with a "Room expired and deleted" notification.

## **Required Mobile Components & Views**

1. **View: Room Dashboard** (Dynamic list of active room cards).
2. **View: Chat Interface** (Sticky footer input).
3. **View: Post-Creation Invitation** (Large QR code + Share button).
4. **View/Component: Room Detail Overlay** (Member list + Invite trigger + Leave/Delete action).
5. **Component: Floating Status Pill** (Animated countdown + Integrated Boost icon).
6. **Component: Room Card** (Status, name, and time remaining).
7. **Component: Slide-up Bottom Sheet** (Shared for Invites and Boost selections).
8. **View: Room Full** — Full-screen state for non-members. Lists applicable boost options (those that would raise the participant cap above the current count). Falls back to "at max capacity" message if none apply.
9. **Component: Boost Option Card** — Displays boost name, what it adds (expiry + cap), and price. Fetched from `GET /v1/boost-options`. Reused in both the in-room Bottom Sheet and the Room Full screen.
