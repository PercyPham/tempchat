package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/middleware"
	"github.com/percypham/tempchat/internal/store"
)

// GetEvents handles GET /v1/rooms/:roomId/events?afterEid=N.
func GetEvents(s store.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")

		afterEid := int64(0)
		if v := c.Query("afterEid"); v != "" {
			parsed, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_after_eid"})
				return
			}
			afterEid = parsed
		}

		// Enforce join_eid as the minimum lower bound so users cannot fetch
		// events that occurred before they joined.
		ctx := appctx.FromGin(c)
		if claims, ok := c.Get(middleware.ClaimsKey); ok {
			if typed, ok := claims.(*auth.RoomAccessTokenClaims); ok && typed.Uid != nil {
				joinEid, err := s.GetUserJoinEid(ctx, roomID, *typed.Uid)
				if err == nil {
					// joinEid is the eid of the user's own "joined" event; use
					// joinEid-1 as the exclusive lower bound so the join event
					// itself is included.
					minAfterEid := joinEid - 1
					if afterEid < minAfterEid {
						afterEid = minAfterEid
					}
				}
			}
		}

		events, err := s.GetEvents(ctx, roomID, afterEid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
			return
		}

		resp := make([]gin.H, 0, len(events))
		for _, ev := range events {
			entry := gin.H{
				"eid": ev.Eid,
				"uid": ev.UID,
				"ts":  ev.Ts,
			}
			if ev.Type != "" {
				entry["type"] = ev.Type
			}
			if ev.Msg != "" {
				entry["msg"] = ev.Msg
			}
			resp = append(resp, entry)
		}
		c.JSON(http.StatusOK, resp)
	}
}
