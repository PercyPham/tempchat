// Package appctx defines AppCtx, the request-scoped context passed as the
// first parameter to all handler and store functions.
package appctx

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
)

// AppCtx is the request-scoped context passed as the first param to all
// handler and store functions. It embeds context.Context so it satisfies
// the context.Context interface and can be passed to Redis/hub calls directly.
type AppCtx struct {
	context.Context
	Now time.Time
}

// FromGin creates an AppCtx from a Gin request context, capturing time.Now()
// at the point of construction.
func FromGin(c *gin.Context) AppCtx {
	return AppCtx{
		Context: c.Request.Context(),
		Now:     time.Now(),
	}
}

// ForEvent returns a new AppCtx derived from the receiver, with Now refreshed
// to the current time. Use when processing individual events within a long-lived
// connection (e.g. WebSocket) so each event gets an accurate timestamp.
func (a AppCtx) ForEvent() AppCtx {
	return AppCtx{
		Context: a.Context,
		Now:     time.Now(),
	}
}
