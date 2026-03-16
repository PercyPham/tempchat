package handler

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	"github.com/percypham/tempchat/internal/store"
)

// wsMessage is the shape of a client-sent WebSocket frame.
type wsMessage struct {
	Event string `json:"event"`
	M     string `json:"m"` // encrypted ciphertext for message:send
}

// WsHandler handles GET /v1/rooms/:roomId/ws.
func WsHandler(s store.Store, h *hub.Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		roomID := c.Param("roomId")

		claims, _ := c.Get(middleware.ClaimsKey)
		claimsTyped, _ := claims.(*auth.RoomAccessTokenClaims)
		userID := ""
		if claimsTyped != nil && claimsTyped.Uid != nil {
			userID = *claimsTyped.Uid
		}

		ws, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
			InsecureSkipVerify: false, // enforce Origin check in production
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "upgrade_failed"})
			return
		}

		ctx := appctx.FromGin(c)
		conn := hub.NewConn(ws)
		h.Subscribe(roomID, conn)
		defer func() {
			h.Unsubscribe(roomID, conn)
			conn.Close()
			ws.CloseNow()
		}()

		for {
			_, data, err := ws.Read(ctx)
			if err != nil {
				break
			}

			var msg wsMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				continue
			}

			if msg.Event != "message:send" || msg.M == "" || userID == "" {
				continue
			}

			event, err := s.AppendMessage(ctx, roomID, userID, msg.M)
			if err != nil {
				log.Printf("ws: AppendMessage error: %v", err)
				continue
			}

			_ = h.Publish(ctx, roomID, gin.H{
				"event": "message:received",
				"eid":   event.Eid,
				"uid":   event.UID,
				"msg":   event.Msg,
				"ts":    event.Ts,
			})
		}
	}
}
