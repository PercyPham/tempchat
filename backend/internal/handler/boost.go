package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/percypham/tempchat/internal/boostoptions"
)

// GetBoostOptions handles GET /v1/boost-options.
func GetBoostOptions() gin.HandlerFunc {
	return func(c *gin.Context) {
		opts := boostoptions.GetBoostOptions()
		resp := make([]gin.H, len(opts))
		for i, o := range opts {
			resp[i] = gin.H{
				"id":              o.ID,
				"name":            o.Name,
				"ttlMs":           o.TTL.Milliseconds(),
				"maxParticipants": o.MaxParticipants,
				"maxEvents":       o.MaxEvents,
				"pricing": gin.H{
					"usdCents":      o.Pricing.USDCents,
					"vnd":           o.Pricing.VND,
					"paddlePriceId": o.Pricing.PaddlePriceID,
				},
			}
		}
		c.JSON(http.StatusOK, resp)
	}
}
