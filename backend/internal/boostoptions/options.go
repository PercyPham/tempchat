// Package boostoptions provides the static list of available boost tiers.
// Options are served from memory; pricing can be region-specific.
package boostoptions

// RegionPricing holds a localised price for a specific region.
type RegionPricing struct {
	Region string // ISO 3166-1 alpha-2, e.g. "VN"
	Price  string // display string, e.g. "69.000 ₫"
}

// BoostOption describes a purchasable room upgrade.
type BoostOption struct {
	ID              string
	Name            string
	TtlMs           int64 // duration added to room expiry, in milliseconds
	MaxParticipants int
	MaxEvents       int
	Price           string         // international display price
	RegionPricing   *RegionPricing // nil when no region-specific pricing applies
}

var options = []BoostOption{
	{
		ID:              "boost_plus",
		Name:            "Plus Boost",
		TtlMs:           86_400_000, // 24 hours
		MaxParticipants: 10,
		MaxEvents:       100,
		Price:           "$2.99",
		RegionPricing:   &RegionPricing{Region: "VN", Price: "69.000 ₫"},
	},
	{
		ID:              "boost_pro",
		Name:            "Pro Boost",
		TtlMs:           604_800_000, // 7 days
		MaxParticipants: 50,
		MaxEvents:       100,
		Price:           "$9.99",
		RegionPricing:   &RegionPricing{Region: "VN", Price: "229.000 ₫"},
	},
}

// GetBoostOptions returns the full list of available boost options.
func GetBoostOptions() []BoostOption {
	return options
}
