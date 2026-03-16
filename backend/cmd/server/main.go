package main

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/percypham/tempchat/internal/common/config"
	"github.com/percypham/tempchat/internal/handler"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

func main() {
	godotenv.Load() // .env (no-op if absent)
	config.Load()

	gin.SetMode(config.App().GinMode)

	rdb := storeredis.NewClient(config.Redis().Addr)
	s := storeredis.New(rdb)
	h := hub.New(rdb)

	r := gin.Default()
	r.Use(corsMiddleware(config.App().AllowedOrigins))

	v1 := r.Group("/v1")
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "mode": config.App().Mode})
	})

	// Public endpoints
	v1.POST("/rooms", handler.CreateRoom(s))
	v1.GET("/boost-options", handler.GetBoostOptions())

	// Auth-gated endpoints
	authed := v1.Group("", middleware.RequireAuth(s))
	authed.GET("/rooms/:roomId", handler.GetRoom(s))
	authed.POST("/rooms/:roomId/join", handler.JoinRoom(s, h))
	authed.GET("/rooms/:roomId/events", handler.GetEvents(s))
	authed.GET("/rooms/:roomId/ws", handler.WsHandler(s, h))

	addr := ":" + config.App().Port
	log.Printf("Server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func corsMiddleware(allowedOrigins string) gin.HandlerFunc {
	origins := strings.Split(allowedOrigins, ",")
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		for _, allowed := range origins {
			if strings.TrimSpace(allowed) == origin {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				c.Header("Access-Control-Allow-Headers", "Content-Type, X-TempChat-Auth")
				break
			}
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
