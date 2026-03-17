// Package handler contains Gin route handlers for TempChat API endpoints.
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

// createRoomBody is the request body for POST /v1/rooms.
type createRoomBody struct {
	Name        string `json:"name"        binding:"required"` // AES-GCM ciphertext (base64) of the room name
	PublicKey   string `json:"publicKey"   binding:"required"` // ECDSA P-384 public key as JWK JSON
	CreatorName string `json:"creatorName" binding:"required"` // AES-GCM ciphertext (base64) of the creator's display name
}

// CreateRoom handles POST /v1/rooms.
func CreateRoom(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body createRoomBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		ctx := appctx.FromGin(c)
		result, err := s.CreateRoom(ctx, store.CreateRoomRequest{
			Name:        body.Name,
			PublicKey:   body.PublicKey,
			CreatorName: body.CreatorName,
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"roomId":    result.RoomID,
			"createdAt": result.CreatedAt,
			"expiresAt": result.ExpiresAt,
			"userId":    result.UserID,
			"joinEid":   result.JoinEid,
		})
	}
}

// GetRoom handles GET /v1/rooms/:roomId.
func GetRoom(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")
		ctx := appctx.FromGin(c)
		room, err := s.GetRoom(ctx, roomID)
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}
		c.JSON(http.StatusOK, roomToResponse(room))
	}
}

// joinRoomBody is the request body for POST /v1/rooms/:roomId/join.
type joinRoomBody struct {
	Name string `json:"name" binding:"required"` // AES-GCM ciphertext (base64) of the display name
}

// JoinRoom handles POST /v1/rooms/:roomId/join.
func JoinRoom(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")

		var body joinRoomBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		ctx := appctx.FromGin(c)
		result, err := s.JoinRoom(ctx, roomID, body.Name)
		if err != nil {
			if errors.Is(err, storeredis.ErrRoomFull) {
				c.JSON(http.StatusForbidden, gin.H{"error": "room_full"})
				return
			}
			if errors.Is(err, storeredis.ErrRoomNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "room_not_found"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		// broadcast user:joined to all connected clients
		_ = h.Publish(ctx, roomID, gin.H{
			"event": "user:joined",
			"eid":   result.JoinEid,
			"uid":   result.UserID,
			"ts":    ctx.Now.UnixMilli(),
		})

		members := make([]gin.H, len(result.Room.Members))
		for i, m := range result.Room.Members {
			members[i] = gin.H{"uid": m.UID, "name": m.Name}
		}

		c.JSON(http.StatusOK, gin.H{
			"userId":  result.UserID,
			"joinEid": result.JoinEid,
			"room":    roomToResponse(result.Room),
		})
	}
}

func roomToResponse(r *store.Room) gin.H {
	members := make([]gin.H, len(r.Members))
	for i, m := range r.Members {
		entry := gin.H{"uid": m.UID, "name": m.Name, "joinedAt": m.JoinedAt}
		if m.LeftAt != 0 {
			entry["leftAt"] = m.LeftAt
		}
		members[i] = entry
	}
	return gin.H{
		"name":            r.Name,
		"expiresAt":       r.ExpiresAt,
		"memberCount":     r.MemberCount,
		"maxParticipants": r.MaxParticipants,
		"maxEvents":       r.MaxEvents,
		"members":         members,
	}
}
