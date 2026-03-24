// Package boostoptions provides the static list of available boost tiers.
// Options are served from memory; pricing can be region-specific.
package boostoptions

import "time"

// RegionalPrice holds a localised price for a specific region.
type RegionalPrice struct {
	Region string // ISO 3166-1 alpha-2, e.g. "VN"
	Price  string // display string, e.g. "69.000 ₫"
}

// BoostOption describes a purchasable room upgrade.
type BoostOption struct {
	ID              string
	Name            string
	TTL             time.Duration
	MaxParticipants int
	MaxEvents       int
	Price           string          // default display price
	RegionalPrices  []RegionalPrice // per-region overrides; nil = none
}

// PriceFor returns the display price for the given region (ISO 3166-1 alpha-2),
// falling back to the default Price if no regional override exists.
func (o BoostOption) PriceFor(region string) string {
	for _, rp := range o.RegionalPrices {
		if rp.Region == region {
			return rp.Price
		}
	}
	return o.Price
}

var options = []BoostOption{
	{
		ID:              "boost_plus",
		Name:            "Plus Boost",
		TTL:             24 * time.Hour,
		MaxParticipants: 10,
		MaxEvents:       100,
		Price:           "$5",
		RegionalPrices:  []RegionalPrice{{Region: "VN", Price: "20.000 ₫"}},
	},
	{
		ID:              "boost_pro",
		Name:            "Pro Boost",
		TTL:             7 * 24 * time.Hour,
		MaxParticipants: 50,
		MaxEvents:       200,
		Price:           "$10",
		RegionalPrices:  []RegionalPrice{{Region: "VN", Price: "50.000 ₫"}},
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
