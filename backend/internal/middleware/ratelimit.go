package middleware

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis_rate/v10"
)

// IPRateLimit returns a Gin middleware that enforces a per-IP GCRA rate limit
// using Redis. The full Redis key is "<key>:<clientIP>". On Redis errors it
// fails open (passes the request through) to avoid blocking users during
// infrastructure failures.
func IPRateLimit(limiter *redis_rate.Limiter, key string, limit redis_rate.Limit) gin.HandlerFunc {
	return func(c *gin.Context) {
		fullKey := key + ":" + c.ClientIP()
		res, err := limiter.Allow(c.Request.Context(), fullKey, limit)
		if err != nil {
			log.Printf("rate_limit: Redis error for key %s: %v (failing open)", fullKey, err)
			c.Next()
			return
		}
		if res.Allowed == 0 {
			c.Header("Retry-After", res.RetryAfter.String())
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate_limit_exceeded"})
			return
		}
		c.Next()
	}
}
