package main

import (
	"encoding/base64"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/percypham/tempchat/internal/appctx"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/common/config"
	"github.com/percypham/tempchat/internal/handler"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

func main() {
	godotenv.Load(".env.test")
	config.Load()
	gin.SetMode(gin.TestMode)

	rdb := storeredis.NewClient(config.Redis().Addr)
	s := storeredis.New(rdb)
	h := hub.New(rdb)

	r := gin.Default()

	v1 := r.Group("/v1")
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "mode": config.App().Mode})
	})
	v1.POST("/rooms", handler.CreateRoom(s))
	v1.POST("/test/echo-claims", echoClaimsHandler)

	authed := v1.Group("", middleware.RequireAuth(s))
	authed.GET("/rooms/:roomId", handler.GetRoom(s))
	authed.POST("/rooms/:roomId/join", handler.JoinRoom(s, h))
	authed.DELETE("/rooms/:roomId/members/me", handler.LeaveRoom(s, h))
	authed.GET("/rooms/:roomId/events", handler.GetEvents(s))
	authed.GET("/rooms/:roomId/ws", handler.WsHandler(s, h))

	addr := ":" + config.App().Port
	log.Printf("Test server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Test server failed: %v", err)
	}
}

type echoClaimsRequest struct {
	RoomAccessKey   string `json:"accessKey" binding:"required"`
	RoomAccessToken string `json:"token"     binding:"required"`
}

func echoClaimsHandler(c *gin.Context) {
	var req echoClaimsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	keyBytes, err := base64.RawURLEncoding.DecodeString(req.RoomAccessKey)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid accessKey encoding"})
		return
	}

	claims, err := auth.VerifyRoomAccessToken(appctx.FromGin(c).Now, req.RoomAccessToken, keyBytes)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, claims)
}
