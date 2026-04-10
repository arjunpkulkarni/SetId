-- Add Apple Sign In support to users table
ALTER TABLE users 
ADD COLUMN apple_id VARCHAR(255) UNIQUE,
ADD COLUMN auth_provider VARCHAR(50) DEFAULT 'email',
ALTER COLUMN password_hash DROP NOT NULL;

-- Create index for apple_id
CREATE INDEX idx_users_apple_id ON users(apple_id);

-- Update existing users to have email auth provider
UPDATE users SET auth_provider = 'email' WHERE auth_provider IS NULL;