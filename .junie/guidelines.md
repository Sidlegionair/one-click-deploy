# Project Guidelines

This document provides guidelines and information for developers working on this Vendure e-commerce project.

## Build/Configuration Instructions

### Prerequisites

- Node.js >= 18.13.0 (required by Angular dependencies)
- npm >= 8.0.0 or yarn >= 1.13.0
- PostgreSQL database

### Environment Setup

1. Clone the repository
2. Copy `.env.example` to `.env` and configure the environment variables:
   ```
   DB=postgres
   DB_USERNAME=postgres
   DB_PASSWORD=postgres
   DB_PORT=5432
   DB_NAME=vendure_test
   DB_HOST=localhost
   DB_SCHEMA=public
   MOLLIE_API_KEY=your_mollie_api_key
   MOLLIE_CLIENT_ID=your_mollie_client_id
   MOLLIE_CLIENT_SECRET=your_mollie_client_secret
   VENDURE_HOST=http://localhost/vendure
   FRONTEND_URLS=https://localhost:3001,http://localhost:3000
   APP_ENV=dev
   COOKIE_SECRET=your_cookie_secret
   SUPERADMIN_USERNAME=superadmin
   SUPERADMIN_PASSWORD=superadmin
   RUN_JOB_QUEUE_FROM_SERVER=false
   FRONTEND_URL=http://localhost:3001
   RESEND_API_KEY=your_resend_api_key
   ```

### Installation

```bash
npm install
# or
yarn install
```

### Development

To start the development server:

```bash
npm run dev
# or
yarn dev
```

This will start both the server and worker processes using `concurrently`.

### Building for Production

```bash
npm run build:prod
# or
yarn build:prod
```

This will:
1. Build the admin UI
2. Compile TypeScript files
3. Copy admin UI assets to the dist directory

### Running in Production

```bash
npm start
# or
yarn start
```

This will start both the server and worker processes using the compiled JavaScript files.

### Docker Setup

The project includes Docker configuration for easy deployment:

```bash
docker-compose up -d
```

This will start three containers:
- server: The Vendure server
- worker: The Vendure worker for background jobs
- database: PostgreSQL database

## Testing Information

### Setting Up Tests

1. Install Jest and related packages:

```bash
npm install --save-dev jest @types/jest ts-jest
```

2. Create a Jest configuration file (`jest.config.js`):

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
```

3. Add a test script to `package.json`:

```json
"scripts": {
  "test": "jest"
}
```

### Writing Tests

Tests should be placed in the same directory as the file they're testing, with a `.spec.ts` extension.

Example test for a service:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { YourService } from './your.service';
import { DependencyService } from '../dependency/dependency.service';

// Mock dependencies
const mockDependencyService = {
  someMethod: jest.fn().mockResolvedValue({}),
};

describe('YourService', () => {
  let service: YourService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YourService,
        { provide: DependencyService, useValue: mockDependencyService },
      ],
    }).compile();

    service = module.get<YourService>(YourService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Add more tests here
});
```

### Running Tests

```bash
npm test
# or
yarn test
```

To run tests with coverage:

```bash
npm test -- --coverage
# or
yarn test --coverage
```

## Additional Development Information

### Project Structure

- `src/`: Source code
  - `plugins/`: Vendure plugins
    - `multivendor-plugin/`: Multivendor functionality
    - `reviews/`: Product reviews functionality
  - `admin-ui/`: Admin UI customizations
  - `config/`: Configuration files
  - `index.ts`: Server entry point
  - `index-worker.ts`: Worker entry point
  - `vendure-config.ts`: Vendure configuration

### Code Style

- The project uses TypeScript with strict type checking
- NestJS decorators are used for dependency injection
- Services should be stateless and use dependency injection
- Use async/await for asynchronous operations

### Plugin Development

When developing new plugins:

1. Create a new directory in `src/plugins/`
2. Create a main plugin file that extends `VendurePlugin`
3. Register the plugin in `src/vendure-config.ts`
4. Organize code into:
   - `api/`: GraphQL API extensions
   - `service/`: Business logic
   - `entities/`: Database entities
   - `ui/`: Admin UI extensions

### Debugging

- Development mode enables GraphQL playgrounds at:
  - Admin API: http://localhost:3000/admin-api
  - Shop API: http://localhost:3000/shop-api
- Set `APP_ENV=dev` in `.env` to enable debug features
- Check logs in the console for detailed error information

### Deployment

The project is configured for Docker deployment. Update the `Dockerfile` and `docker-compose.yml` as needed for your production environment.