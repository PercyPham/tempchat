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
			entry := gin.H{
				"id":              o.ID,
				"name":            o.Name,
				"ttlMs":           o.TtlMs,
				"maxParticipants": o.MaxParticipants,
				"maxEvents":       o.MaxEvents,
				"price":           o.Price,
			}
			if o.RegionPricing != nil {
				entry["regionPricing"] = gin.H{
					"region": o.RegionPricing.Region,
					"price":  o.RegionPricing.Price,
				}
			}
			resp[i] = entry
		}
		c.JSON(http.StatusOK, resp)
	}
}
