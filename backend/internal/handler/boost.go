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
				"ttlMs":           o.TTL.Milliseconds(),
				"maxParticipants": o.MaxParticipants,
				"maxEvents":       o.MaxEvents,
				"price":           o.Price,
			}
			if len(o.RegionalPrices) > 0 {
				rp := make([]gin.H, len(o.RegionalPrices))
				for j, r := range o.RegionalPrices {
					rp[j] = gin.H{"region": r.Region, "price": r.Price}
				}
				entry["regionalPrices"] = rp
			}
			resp[i] = entry
		}
		c.JSON(http.StatusOK, resp)
	}
}
