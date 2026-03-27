// Package boostoptions provides the static list of available boost tiers.
// Options are served from memory; pricing is loaded from environment variables.
package boostoptions

import "time"

// Pricing holds the authoritative amounts for each supported currency.
// USDCents is used by Polar; VND is used by SePay.
// PolarProductPriceID is backend-only and never exposed in API responses.
type Pricing struct {
	USDCents           int    // e.g. 500 = $5.00
	VND                int64  // e.g. 120000 = 120.000 ₫
	PolarProductPriceID string // Polar product price ID, e.g. "pp_01abc..."
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
			PolarProductPriceID: "",
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
			PolarProductPriceID: "",
		},
	},
}

// PricingConfig holds the env-loaded pricing values passed from config at startup.
type PricingConfig struct {
	PolarPriceIDBoostPlus string
	PolarPriceIDBoostPro  string
	BoostPlusVND          int64
	BoostProVND           int64
}

// Init populates runtime pricing from environment variables.
// Must be called once after config.Load() in main.
func Init(cfg PricingConfig) {
	if cfg.PolarPriceIDBoostPlus != "" {
		options[0].Pricing.PolarProductPriceID = cfg.PolarPriceIDBoostPlus
	}
	if cfg.BoostPlusVND > 0 {
		options[0].Pricing.VND = cfg.BoostPlusVND
	}
	if cfg.PolarPriceIDBoostPro != "" {
		options[1].Pricing.PolarProductPriceID = cfg.PolarPriceIDBoostPro
	}
	if cfg.BoostProVND > 0 {
		options[1].Pricing.VND = cfg.BoostProVND
	}
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
