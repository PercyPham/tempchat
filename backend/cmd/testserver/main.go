package main

import (
	"encoding/base64"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/percypham/tempchat/internal/auth"
	"github.com/percypham/tempchat/internal/common/config"
)

func main() {
	godotenv.Load(".env.test")
	config.Load()
	gin.SetMode(gin.TestMode)

	r := gin.Default()

	v1 := r.Group("/v1")
	v1.GET("/health", func(c *gin.Context) { c.Status(http.StatusOK) })
	v1.POST("/test/echo-claims", echoClaimsHandler)

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

	claims, err := auth.VerifyRoomAccessToken(req.RoomAccessToken, keyBytes)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, claims)
}
