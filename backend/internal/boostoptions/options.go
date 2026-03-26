// Package boostoptions provides the static list of available boost tiers.
// Options are served from memory; pricing is loaded from environment variables.
package boostoptions

import "time"

// Pricing holds the authoritative amounts for each supported currency.
// USDCents is used by Paddle; VND is used by SePay.
// PaddlePriceID is backend-only and never exposed in API responses.
type Pricing struct {
	USDCents      int    // e.g. 500 = $5.00
	VND           int64  // e.g. 120000 = 120.000 ₫
	PaddlePriceID string // Paddle price ID, e.g. "pri_01abc..."
}

// BoostOption describes a purchasable room upgrade.
type BoostOption struct {
	ID              string
	Name            string
	TTL             time.Duration
	MaxParticipants int
	MaxEvents       int
	Pricing         Pricing
}

var options = []BoostOption{
	{
		ID:              "boost_plus",
		Name:            "Plus Boost",
		TTL:             24 * time.Hour,
		MaxParticipants: 10,
		MaxEvents:       100,
		Pricing: Pricing{
			USDCents:      500,
			VND:           20000,
			PaddlePriceID: "",
		},
	},
	{
		ID:              "boost_pro",
		Name:            "Pro Boost",
		TTL:             7 * 24 * time.Hour,
		MaxParticipants: 50,
		MaxEvents:       200,
		Pricing: Pricing{
			USDCents:      1000,
			VND:           50000,
			PaddlePriceID: "",
		},
	},
}

// GetBoostOptions returns all available boost options.
func GetBoostOptions() []BoostOption { return options }

// GetBoostOption returns the option with the given ID, or false if not found.
func GetBoostOption(id string) (BoostOption, bool) {
	for _, o := range options {
		if o.ID == id {
			return o, true
		}
	}
	return BoostOption{}, false
}
