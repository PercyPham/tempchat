// Package handler contains Gin route handlers for TempChat API endpoints.
package handler

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/store"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

// createRoomBody is the request body for POST /v1/rooms.
type createRoomBody struct {
	Name        string `json:"name"        binding:"required"`
	AccessKey   string `json:"accessKey"   binding:"required"` // base64url-encoded raw key bytes
	CreatorName string `json:"creatorName" binding:"required"`
}

// CreateRoom handles POST /v1/rooms.
func CreateRoom(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body createRoomBody
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
			return
		}

		accessKey, err := base64.RawURLEncoding.DecodeString(body.AccessKey)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_access_key"})
			return
		}

		result, err := s.CreateRoom(c.Request.Context(), store.CreateRoomRequest{
			Name:        body.Name,
			AccessKey:   accessKey,
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
		room, err := s.GetRoom(c.Request.Context(), roomID)
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
	DisplayName string `json:"displayName" binding:"required"`
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

		result, err := s.JoinRoom(c.Request.Context(), roomID, body.DisplayName)
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
		_ = h.Publish(c.Request.Context(), roomID, gin.H{
			"event": "user:joined",
			"eid":   result.JoinEid,
			"uid":   result.UserID,
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
		members[i] = gin.H{"uid": m.UID, "name": m.Name}
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
