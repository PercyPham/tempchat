package config

import "os"

type Config struct {
	Port           string
	RedisAddr      string
	AllowedOrigins string
	GinMode        string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "8080"),
		RedisAddr:      getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		AllowedOrigins: getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		GinMode:        getEnv("GIN_MODE", "debug"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
