// Package store defines the storage interface and shared types for TempChat.
// The Redis implementation lives in store/redis/. Future backends (e.g. Firestore
// for payment records) can implement this interface independently.
package store

import "github.com/percypham/tempchat/internal/appctx"

// Store is the primary storage interface for room and event operations.
type Store interface {
	CreateRoom(ctx appctx.AppCtx, req CreateRoomRequest) (*CreateRoomResult, error)
	GetRoom(ctx appctx.AppCtx, roomID string) (*Room, error)
	GetRoomAccessKey(ctx appctx.AppCtx, roomID string) ([]byte, error)
	JoinRoom(ctx appctx.AppCtx, roomID, name string) (*JoinResult, error)
	SetUserLeft(ctx appctx.AppCtx, roomID, userID string) (int64, error)
	AppendMessage(ctx appctx.AppCtx, roomID, userID, ciphertext string) (*Event, error)
	GetEvents(ctx appctx.AppCtx, roomID string, afterEid int64) ([]Event, error)
	GetUserJoinEid(ctx appctx.AppCtx, roomID, userID string) (int64, error)
}

// CreateRoomRequest is the input for creating a new room.
type CreateRoomRequest struct {
	Name        string // AES-GCM ciphertext (base64) of the room name; opaque to server
	AccessKey   []byte // raw HMAC key bytes derived client-side via PBKDF2
	CreatorName string // AES-GCM ciphertext (base64) of the creator's display name; opaque to server
}

// CreateRoomResult is returned after a room is successfully created.
type CreateRoomResult struct {
	RoomID    string
	CreatedAt int64  // unix ms
	ExpiresAt int64  // unix ms
	UserID    string // creator's userId
	JoinEid   int64
}

// JoinResult is returned after a user successfully joins a room.
type JoinResult struct {
	UserID  string
	JoinEid int64
	Room    *Room
}

// Room represents the current state of a chat room.
type Room struct {
	ID              string
	Name            string
	CreatedAt       int64 // unix ms
	ExpiresAt       int64 // unix ms
	MaxParticipants int
	MaxEvents       int
	MemberCount     int
	Members         []Member
}

// Member is a user in the room's member list.
type Member struct {
	UID      string
	Name     string // AES-GCM ciphertext (base64) of the display name; opaque to server
	JoinedAt int64  // unix ms
	LeftAt   int64  // unix ms; 0 if still in room
}

// Event is a single entry in the room event log.
type Event struct {
	Eid  int64
	Type string // "" = chat message, "joined", "left", "boosted"
	UID  string
	Msg  string // encrypted ciphertext; only set for chat events
	Ts   int64  // unix ms
}
