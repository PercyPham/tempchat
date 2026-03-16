package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
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

		events, err := s.GetEvents(c.Request.Context(), roomID, afterEid)
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
