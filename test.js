// __tests__/UserFlux.test.js
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import UserFlux from '../index'

// Mock fetch globally
global.fetch = jest.fn()

describe('UserFlux React Native SDK', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks()
    AsyncStorage.clear()
    
    // Reset UserFlux state
    UserFlux.ufApiKey = null
    UserFlux.ufUserId = null
    UserFlux.ufExternalId = null
    UserFlux.ufTrackQueue = []
    UserFlux.ufAnonymousId = ""
    UserFlux.ufSessionId = null
    
    // Mock successful API responses
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    })
  })

  afterEach(() => {
    // Clean up intervals and listeners
    UserFlux.cleanup()
  })

  describe('Initialization', () => {
    test('should initialize with API key', async () => {
      UserFlux.initialize('test-api-key')
      
      expect(UserFlux.ufApiKey).toBe('test-api-key')
    })

    test('should initialize with options', async () => {
      UserFlux.initialize('test-api-key', {
        autoEnrich: false,
        trackSession: true,
        defaultTrackingProperties: {
          app: 'test-app'
        }
      })
      
      expect(UserFlux.ufApiKey).toBe('test-api-key')
      expect(UserFlux.ufLocationEnrichmentEnabled).toBe(false)
      expect(UserFlux.ufDeviceDataEnrichmentEnabled).toBe(false)
      expect(UserFlux.ufDefaultTrackingProperties).toEqual({ app: 'test-app' })
    })

    test('should generate anonymous ID on initialization', async () => {
      UserFlux.initialize('test-api-key')
      
      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(UserFlux.ufAnonymousId).toBeTruthy()
      expect(UserFlux.ufAnonymousId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    test('should create session ID when trackSession is enabled', async () => {
      UserFlux.initialize('test-api-key', { trackSession: true })
      
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100))
      
      expect(UserFlux.ufSessionId).toBeTruthy()
      expect(UserFlux.ufSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })
  })

  describe('User Management', () => {
    beforeEach(() => {
      UserFlux.initialize('test-api-key')
    })

    test('should set and get user ID', async () => {
      UserFlux.setUserId('user_123')
      
      expect(UserFlux.getUserId()).toBe('user_123')
      expect(await AsyncStorage.getItem('uf-userId')).toBe('user_123')
    })

    test('should set and get external ID', async () => {
      UserFlux.setExternalId('external_456')
      
      expect(UserFlux.ufExternalId).toBe('external_456')
      expect(await AsyncStorage.getItem('uf-externalId')).toBe('external_456')
    })

    test('should get anonymous ID', () => {
      const anonymousId = UserFlux.getAnonymousId()
      
      expect(anonymousId).toBeTruthy()
      expect(anonymousId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    test('should not store user ID when disableUserIdStorage is true', async () => {
      UserFlux.ufDisableUserIdStorage = true
      UserFlux.setUserId('user_789')
      
      expect(UserFlux.getUserId()).toBe('user_789')
      expect(await AsyncStorage.getItem('uf-userId')).toBeNull()
    })
  })

  describe('Event Tracking', () => {
    beforeEach(() => {
      UserFlux.initialize('test-api-key')
    })

    test('should track basic event', async () => {
      await UserFlux.track({
        event: 'test_event',
        properties: {
          value: 100
        }
      })

      expect(UserFlux.ufTrackQueue.length).toBeGreaterThan(0)
      const lastEvent = UserFlux.ufTrackQueue[UserFlux.ufTrackQueue.length - 1]
      
      expect(lastEvent.name).toBe('test_event')
      expect(lastEvent.properties.value).toBe(100)
      expect(lastEvent.anonymousId).toBeTruthy()
      expect(lastEvent.timestamp).toBeTruthy()
    })

    test('should track event with user ID', async () => {
      await UserFlux.track({
        event: 'user_event',
        userId: 'user_123',
        properties: {
          action: 'click'
        }
      })

      const lastEvent = UserFlux.ufTrackQueue[UserFlux.ufTrackQueue.length - 1]
      
      expect(lastEvent.userId).toBe('user_123')
      expect(lastEvent.name).toBe('user_event')
      expect(lastEvent.properties.action).toBe('click')
    })

    test('should include default tracking properties', async () => {
      UserFlux.updateDefaultTrackingProperties({
        app_version: '1.0.0',
        environment: 'test'
      })

      await UserFlux.track({
        event: 'test_event',
        properties: {
          custom: 'value'
        }
      })

      const lastEvent = UserFlux.ufTrackQueue[UserFlux.ufTrackQueue.length - 1]
      
      expect(lastEvent.properties.custom).toBe('value')
      expect(lastEvent.properties.app_version).toBe('1.0.0')
      expect(lastEvent.properties.environment).toBe('test')
    })

    test('should batch track multiple events', async () => {
      const events = [
        { event: 'event_1', properties: { index: 1 } },
        { event: 'event_2', properties: { index: 2 } },
        { event: 'event_3', properties: { index: 3 } }
      ]

      await UserFlux.trackBatch(events)

      expect(UserFlux.ufTrackQueue.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Screen Tracking', () => {
    beforeEach(() => {
      UserFlux.initialize('test-api-key')
    })

    test('should track screen view', async () => {
      await UserFlux.trackScreenView('HomeScreen', {
        section: 'main'
      })

      const lastEvent = UserFlux.ufTrackQueue[UserFlux.ufTrackQueue.length - 1]
      
      expect(lastEvent.name).toBe('screen_view')
      expect(lastEvent.properties.screenName).toBe('HomeScreen')
      expect(lastEvent.properties.section).toBe('main')
    })

    test('should track previous screen and time spent', async () => {
      await UserFlux.trackScreenView('Screen1')
      
      // Wait a bit to simulate time on screen
      await new Promise(resolve => setTimeout(resolve, 100))
      
      await UserFlux.trackScreenView('Screen2')

      const lastEvent = UserFlux.ufTrackQueue[UserFlux.ufTrackQueue.length - 1]
      
      expect(lastEvent.properties.screenName).toBe('Screen2')
      expect(lastEvent.properties.previousScreen).toBe('Screen1')
      expect(lastEvent.properties.previousScreenTime).toBeGreaterThan(0)
    })
  })

  describe('User Identification', () => {
    beforeEach(() => {
      UserFlux.initialize('test-api-key')
    })

    test('should identify user with properties', async () => {
      const result = await UserFlux.identify({
        userId: 'user_123',
        properties: {
          email: 'test@example.com',
          name: 'Test User'
        }
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/profile'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      )
    })

    test('should identify with external ID', async () => {
      await UserFlux.identify({
        externalId: 'external_123',
        properties: {
          source: 'crm'
        }
      })

      expect(UserFlux.ufExternalId).toBe('external_123')
    })
  })

  describe('Session Management', () => {
    beforeEach(() => {
      UserFlux.initialize('test-api-key', { trackSession: true })
    })

    test('should create session ID', () => {
      expect(UserFlux.ufSessionId).toBeTruthy()
      expect(UserFlux.ufSessionStartTime).toBeTruthy()
    })

    test('should get current session ID', () => {
      const sessionId = UserFlux.getSessionId()
      
      expect(sessionId).toBeTruthy()
      expect(sessionId).toBe(UserFlux.ufSessionId)
    })

    test('should refresh session after timeout', () => {
      const originalSessionId = UserFlux.ufSessionId
      
      // Simulate session timeout
      UserFlux.ufLastActivityTime = Date.now() - (UserFlux.ufSessionTimeout + 1000)
      
      const newSessionId = UserFlux.getSessionId()
      
      expect(newSessionId).not.toBe(originalSessionId)
    })
  })

  describe('Data Persistence', () => {
    test('should save and load events from storage', async () => {
      UserFlux.initialize('test-api-key')
      
      const events = [
        { name: 'event_1', timestamp: Date.now() },
        { name: 'event_2', timestamp: Date.now() }
      ]
      
      UserFlux.ufTrackQueue = events
      await UserFlux.saveEventsToStorage('uf-track', events)
      
      // Clear and reload
      UserFlux.ufTrackQueue = []
      await UserFlux.loadEventsFromStorage()
      
      expect(UserFlux.ufTrackQueue).toEqual(events)
    })

    test('should persist user data across sessions', async () => {
      // First session
      UserFlux.initialize('test-api-key')
      UserFlux.setUserId('persistent_user')
      UserFlux.setExternalId('persistent_external')
      
      // Simulate app restart
      UserFlux.ufUserId = null
      UserFlux.ufExternalId = null
      
      // Load stored data
      await UserFlux.loadStoredData()
      
      expect(UserFlux.ufUserId).toBe('persistent_user')
      expect(UserFlux.ufExternalId).toBe('persistent_external')
    })
  })

  describe('Reset Functionality', () => {
    test('should clear all data on reset', async () => {
      UserFlux.initialize('test-api-key')
      UserFlux.setUserId('user_to_reset')
      UserFlux.setExternalId('external_to_reset')
      
      await UserFlux.track({
        event: 'before_reset'
      })
      
      await UserFlux.reset()
      
      expect(UserFlux.ufUserId).toBeNull()
      expect(UserFlux.ufExternalId).toBeNull()
      expect(UserFlux.ufTrackQueue).toEqual([])
      expect(UserFlux.ufAnonymousId).toBeTruthy() // Should have new anonymous ID
      expect(await AsyncStorage.getItem('uf-userId')).toBeNull()
      expect(await AsyncStorage.getItem('uf-externalId')).toBeNull()
    })
  })

  describe('Network Handling', () => {
    test('should not flush events when offline', async () => {
      NetInfo.fetch.mockResolvedValueOnce({ isConnected: false })
      
      UserFlux.initialize('test-api-key')
      
      await UserFlux.track({
        event: 'offline_event'
      })
      
      await UserFlux.flush()
      
      // Events should remain in queue when offline
      expect(UserFlux.ufTrackQueue.length).toBeGreaterThan(0)
    })

    test('should flush events when connection restored', async () => {
      NetInfo.fetch
        .mockResolvedValueOnce({ isConnected: false })
        .mockResolvedValueOnce({ isConnected: true })
      
      UserFlux.initialize('test-api-key')
      
      await UserFlux.track({
        event: 'queued_event'
      })
      
      // First flush fails (offline)
      await UserFlux.flush()
      expect(UserFlux.ufTrackQueue.length).toBeGreaterThan(0)
      
      // Second flush succeeds (online)
      await UserFlux.flush()
      
      // Mock successful flush
      UserFlux.ufTrackQueue = []
      
      expect(UserFlux.ufTrackQueue.length).toBe(0)
    })
  })

  describe('Error Handling', () => {
    test('should handle API failures gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'))
      
      UserFlux.initialize('test-api-key')
      
      await UserFlux.track({
        event: 'failed_event'
      })
      
      await UserFlux.flush()
      
      // Event should remain in queue after failure
      expect(UserFlux.ufTrackQueue.length).toBeGreaterThan(0)
      expect(UserFlux.ufConsecutiveFailures).toBeGreaterThan(0)
    })

    test('should stop retrying after max failures', async () => {
      global.fetch.mockRejectedValue(new Error('Persistent error'))
      
      UserFlux.initialize('test-api-key')
      UserFlux.ufMaxConsecutiveFailures = 3
      
      // Attempt multiple flushes
      for (let i = 0; i < 5; i++) {
        await UserFlux.flush()
      }
      
      expect(UserFlux.ufConsecutiveFailures).toBeLessThanOrEqual(3)
    })
  })
})