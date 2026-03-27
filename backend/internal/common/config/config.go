package config

import (
	"fmt"
	"os"
)

// Load retrieves configs from environment variables,
// panics if those are not set properly.
//
// Call this function as close as possible to the start of your program (ideally in main).
// Load .env files with godotenv before calling this.
func Load() {
	loadAppConfig()
	loadRedisConfig()
	loadPaymentConfig()

	hasConfigLoaded = true
}

var hasConfigLoaded = false

// ensureConfigLoaded will panic if config has not been loaded yet.
func ensureConfigLoaded() {
	if !hasConfigLoaded {
		panic("config.Load() has not been called, make sure to call it " +
			"as close as possible to the start of your program (ideally in main)")
	}
}

// getENV returns the environment variable with matching key,
// panics if not found.
func getENV(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("Expected env with key '%s', found none", key))
	}
	return v
}

// getEnv returns the environment variable with matching key,
// or the provided default if not set.
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
