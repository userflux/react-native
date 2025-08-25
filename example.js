// Example implementation showing how to integrate UserFlux SDK in a React Native app
// File: App.js

import React, { useEffect, useRef } from 'react'
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Button,
  ScrollView,
  AppState
} from 'react-native'
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import UserFlux from '@userflux/react-native'

// Initialize UserFlux SDK
const initializeUserFlux = () => {
  UserFlux.initialize('YOUR_WRITE_KEY_HERE', {
    autoCapture: ['screen_views', 'app_opens'],
    autoEnrich: true,
    trackSession: true,
    defaultTrackingProperties: {
      app_name: 'UserFlux Example App',
      environment: __DEV__ ? 'development' : 'production',
      version: '1.0.0'
    },
    debugMode: __DEV__ // Enable debug mode in development
  })
}

// Example Home Screen
function HomeScreen({ navigation }) {
  const handleLogin = async () => {
    // Identify user after login
    await UserFlux.identify({
      userId: 'user_12345',
      properties: {
        email: 'user@example.com',
        name: 'John Doe',
        plan: 'premium',
        signup_date: '2024-01-15',
        total_purchases: 5
      }
    })

    // Track login event
    await UserFlux.track({
      event: 'user_logged_in',
      properties: {
        method: 'email',
        location: 'home_screen'
      }
    })

    navigation.navigate('Dashboard')
  }

  const handleProductView = async (productId, productName, price) => {
    await UserFlux.track({
      event: 'product_viewed',
      properties: {
        product_id: productId,
        product_name: productName,
        price: price,
        currency: 'USD',
        category: 'electronics'
      }
    })
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View style={styles.section}>
          <Text style={styles.title}>UserFlux Example App</Text>
          
          <View style={styles.buttonContainer}>
            <Button
              title="Login User"
              onPress={handleLogin}
              color="#007AFF"
            />
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title="View Product 1"
              onPress={() => handleProductView('prod_1', 'iPhone 15', 999)}
            />
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title="View Product 2"
              onPress={() => handleProductView('prod_2', 'MacBook Pro', 2499)}
            />
          </View>

          <View style={styles.buttonContainer}>
            <Button
              title="Track Custom Event"
              onPress={async () => {
                await UserFlux.track({
                  event: 'button_pressed',
                  properties: {
                    button_name: 'custom_event',
                    timestamp: new Date().toISOString()
                  }
                })
              }}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

// Example Dashboard Screen
function DashboardScreen({ navigation }) {
  const handlePurchase = async () => {
    // Track purchase event
    await UserFlux.track({
      event: 'purchase_completed',
      properties: {
        order_id: 'order_' + Date.now(),
        total_amount: 99.99,
        currency: 'USD',
        items_count: 2,
        payment_method: 'credit_card',
        shipping_method: 'express'
      }
    })
  }

  const handleLogout = async () => {
    // Track logout
    await UserFlux.track({
      event: 'user_logged_out',
      properties: {
        session_duration: Date.now() - startTime
      }
    })

    // Reset UserFlux (clears user data)
    await UserFlux.reset()

    navigation.navigate('Home')
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.title}>Dashboard</Text>
        
        <Text style={styles.subtitle}>
          User ID: {UserFlux.getUserId() || 'Anonymous'}
        </Text>
        
        <View style={styles.buttonContainer}>
          <Button
            title="Complete Purchase"
            onPress={handlePurchase}
            color="#4CAF50"
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Batch Track Events"
            onPress={async () => {
              await UserFlux.trackBatch([
                {
                  event: 'item_added_to_cart',
                  properties: { item_id: '1', quantity: 1 }
                },
                {
                  event: 'item_added_to_cart',
                  properties: { item_id: '2', quantity: 2 }
                },
                {
                  event: 'cart_viewed',
                  properties: { total_items: 3, total_value: 150 }
                }
              ])
            }}
          />
        </View>

        <View style={styles.buttonContainer}>
          <Button
            title="Logout"
            onPress={handleLogout}
            color="#F44336"
          />
        </View>
      </View>
    </SafeAreaView>
  )
}

const Stack = createNativeStackNavigator()
let startTime = Date.now()

function App() {
  const navigationRef = useNavigationContainerRef()
  const routeNameRef = useRef()
  const appState = useRef(AppState.currentState)

  useEffect(() => {
    // Initialize UserFlux when app starts
    initializeUserFlux()

    // Setup app state listener for background/foreground tracking
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground
        UserFlux.trackAppOpen()
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App went to background
        UserFlux.trackAppBackground()
      }

      appState.current = nextAppState
    })

    // Track initial app open
    UserFlux.trackAppOpen()

    // Cleanup on unmount
    return () => {
      subscription.remove()
      UserFlux.cleanup()
    }
  }, [])

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        // Store initial route name
        routeNameRef.current = navigationRef.getCurrentRoute().name
      }}
      onStateChange={async () => {
        const previousRouteName = routeNameRef.current
        const currentRouteName = navigationRef.getCurrentRoute().name

        if (previousRouteName !== currentRouteName) {
          // Track screen view when screen changes
          await UserFlux.trackScreenView(currentRouteName, {
            previous_screen: previousRouteName
          })
        }

        // Save the current route name for comparison next time
        routeNameRef.current = currentRouteName
      }}
    >
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: '#666',
  },
  buttonContainer: {
    marginVertical: 10,
    paddingHorizontal: 20,
  },
})

export default App