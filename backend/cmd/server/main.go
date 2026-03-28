package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis_rate/v10"
	"github.com/joho/godotenv"
	"github.com/percypham/tempchat/internal/boostoptions"
	"github.com/percypham/tempchat/internal/cleanup"
	"github.com/percypham/tempchat/internal/common/config"
	"github.com/percypham/tempchat/internal/handler"
	"github.com/percypham/tempchat/internal/hub"
	"github.com/percypham/tempchat/internal/middleware"
	storeredis "github.com/percypham/tempchat/internal/store/redis"
)

func main() {
	godotenv.Load() // .env (no-op if absent)
	config.Load()
	boostoptions.Init(boostoptions.PricingConfig{
		PolarProductIDBoostPlus: config.Payment().PolarProductIDBoostPlus,
		PolarProductIDBoostPro:  config.Payment().PolarProductIDBoostPro,
		BoostPlusVND:          config.Payment().BoostPlusVND,
		BoostProVND:           config.Payment().BoostProVND,
	})

	gin.SetMode(config.App().GinMode)

	rdb := storeredis.NewClient(config.Redis().Addr)
	s := storeredis.New(rdb)
	h := hub.New(rdb)
	rl := redis_rate.NewLimiter(rdb)

	r := gin.Default()
	r.Use(corsMiddleware(config.App().AllowedOrigins))

	v1 := r.Group("/v1")
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "mode": config.App().Mode})
	})

	// Public endpoints
	v1.POST("/rooms",
		middleware.IPRateLimit(rl, "rl:create_room", redis_rate.Limit{Rate: 5, Burst: 3, Period: 10 * time.Minute}),
		handler.CreateRoom(s),
	)
	v1.GET("/boost-options",
		middleware.IPRateLimit(rl, "rl:boost_options", redis_rate.Limit{Rate: 30, Burst: 30, Period: time.Minute}),
		handler.GetBoostOptions(),
	)
	v1.GET("/orders/:orderId",
		middleware.IPRateLimit(rl, "rl:order_status", redis_rate.Limit{Rate: 20, Burst: 5, Period: time.Minute}),
		handler.GetOrderStatus(s),
	)
	v1.POST("/payments/sepay/webhook", handler.SepayWebhook(s, h))
	v1.POST("/payments/polar/webhook", handler.PolarWebhook(s, h))

	// Auth-gated endpoints
	authed := v1.Group("", middleware.RequireAuth(s))
	authed.GET("/rooms/:roomId",
		middleware.IPRateLimit(rl, "rl:get_room", redis_rate.Limit{Rate: 20, Burst: 10, Period: time.Minute}),
		handler.GetRoom(s),
	)
	authed.POST("/rooms/:roomId/join",
		middleware.IPRateLimit(rl, "rl:join", redis_rate.Limit{Rate: 10, Burst: 5, Period: time.Minute}),
		handler.JoinRoom(s, h),
	)
	authed.DELETE("/rooms/:roomId/members/me",
		middleware.IPRateLimit(rl, "rl:leave", redis_rate.Limit{Rate: 5, Burst: 3, Period: time.Minute}),
		handler.LeaveRoom(s, h),
	)
	authed.GET("/rooms/:roomId/events",
		middleware.IPRateLimit(rl, "rl:events", redis_rate.Limit{Rate: 20, Burst: 10, Period: time.Minute}),
		handler.GetEvents(s),
	)
	authed.GET("/rooms/:roomId/ws",
		middleware.IPRateLimit(rl, "rl:ws_upgrade", redis_rate.Limit{Rate: 15, Burst: 5, Period: time.Minute}),
		handler.WsHandler(s, h),
	)
	authed.POST("/rooms/:roomId/redeem-coupon",
		middleware.IPRateLimit(rl, "rl:coupon_redeem", redis_rate.Limit{Rate: 10, Burst: 3, Period: time.Minute}),
		handler.RedeemCoupon(s, h),
	)
	authed.POST("/rooms/:roomId/payments/initiate",
		middleware.IPRateLimit(rl, "rl:payment_initiate", redis_rate.Limit{Rate: 10, Burst: 5, Period: time.Minute}),
		handler.InitiatePayment(s),
	)

	workerCtx, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	go cleanup.Run(workerCtx, rdb, s)

	srv := &http.Server{
		Addr:    ":" + config.App().Port,
		Handler: r,
	}

	go func() {
		log.Printf("Server starting on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	cancelWorkers()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced shutdown: %v", err)
	}
	log.Println("Server exited cleanly")
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
