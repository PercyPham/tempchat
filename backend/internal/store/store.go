// Package store defines the storage interface and shared types for TempChat.
// The Redis implementation lives in store/redis/. Future backends (e.g. Firestore
// for payment records) can implement this interface independently.
package store

import "context"

// Store is the primary storage interface for room and event operations.
type Store interface {
	CreateRoom(ctx context.Context, req CreateRoomRequest) (*CreateRoomResult, error)
	GetRoom(ctx context.Context, roomID string) (*Room, error)
	GetRoomAccessKey(ctx context.Context, roomID string) ([]byte, error)
	JoinRoom(ctx context.Context, roomID, displayName string) (*JoinResult, error)
	SetUserLeft(ctx context.Context, roomID, userID string) error
	AppendMessage(ctx context.Context, roomID, userID, ciphertext string) (*Event, error)
	GetEvents(ctx context.Context, roomID string, afterEid int64) ([]Event, error)
}

// CreateRoomRequest is the input for creating a new room.
type CreateRoomRequest struct {
	Name        string
	AccessKey   []byte // raw HMAC key bytes derived client-side via PBKDF2
	CreatorName string
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
	UID  string
	Name string
}

// Event is a single entry in the room event log.
type Event struct {
	Eid  int64
	Type string // "" = chat message, "joined", "left", "boosted"
	UID  string
	Msg  string // encrypted ciphertext; only set for chat events
	Ts   int64  // unix ms
}
