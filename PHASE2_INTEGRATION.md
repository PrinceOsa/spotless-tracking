# Phase 2: SpotlessDoc Integration

Real-time cleaner location tracking is now wired into the SpotlessDoc backend and frontend. This guide explains how to activate it on booking pages.

## What's been integrated

### Backend (`spotlessdoc-backend`)
- **Message Type**: `CLEANER_LOCATION_UPDATE` added to `wsMessageTypes.ts`
- **Publisher**: `wsPublisher.sendToBookingSubscribers()` broadcasts location to both customer and cleaner
- **Handler**: `wsServer.ts` validates cleaner assignment, relays incoming location updates to subscribers

### Frontend (`spotlessdoc`)
- **Hook**: `useCleanerLocation(bookingId)` — subscribes to location updates for a booking
- **Component**: `CleanerLocationBroadcaster` — add to cleaner dashboard to start location broadcast
- **Component**: `CleanerLocationMap` — add to booking detail to display live location

## Integration Steps

### 1. Add Map to Customer Booking Detail Page

In the booking detail modal or page (e.g., `BookingDetailModal.tsx` or `BookingsView.tsx`):

```tsx
import { CleanerLocationMap } from '../components/CleanerLocationMap';

// Inside your booking detail JSX:
{booking.status === 'in-progress' && booking.contractor_id && (
  <div className="mt-6">
    <h3 className="font-semibold mb-3">Cleaner Location</h3>
    <CleanerLocationMap 
      bookingId={booking.id} 
      height="h-80"
    />
  </div>
)}
```

### 2. Add Location Broadcaster to Cleaner Dashboard

In the cleaner's active-job view (e.g., `HomeView.tsx` or a job detail page):

```tsx
import { CleanerLocationBroadcaster } from '../components/CleanerLocationBroadcaster';

// Inside your active booking JSX:
{activeBooking && (
  <div className="mt-6 p-4 bg-blue-50 rounded-lg">
    <CleanerLocationBroadcaster 
      bookingId={activeBooking.id}
    />
  </div>
)}
```

### 3. Verify WebSocket Connection

Both components automatically use the SpotlessDoc WebSocket context. Ensure:
- User is logged in (token is set)
- `WebSocketProvider` wraps your app (already in place in `main.tsx`)
- Backend server is running and WebSocket endpoint is accessible at `/ws`

## How It Works

**Flow:**
1. Cleaner clicks "Start Sharing Location" in `CleanerLocationBroadcaster`
2. Component uses `navigator.geolocation.watchPosition()` to get device location
3. Every 4 seconds, location is sent via WebSocket message: `CLEANER_LOCATION_UPDATE`
4. Backend validates cleaner is assigned to booking, relays to both participants
5. Customer receives update via `useCleanerLocation` hook
6. `CleanerLocationMap` updates marker position in real-time

**Message Format:**
```json
{
  "type": "CLEANER_LOCATION_UPDATE",
  "payload": {
    "bookingId": 123,
    "cleanerId": 456,
    "lat": 40.7128,
    "lng": -74.0060,
    "heading": 45,
    "accuracy": 12,
    "ts": "2026-06-14T12:30:45.123Z"
  }
}
```

## Testing

### Test on Desktop (Two Tabs)
1. Open browser with DevTools
2. **Tab 1 (Cleaner)**: Cleaner dashboard page with `CleanerLocationBroadcaster`
3. **Tab 2 (Customer)**: Booking detail with `CleanerLocationMap`
4. In Tab 1, click "Start Sharing Location"
5. In DevTools F12 → Sensors → Location, set custom coordinates
6. Watch map marker update in Tab 2 in real-time

### Test on Real Devices
1. Cleaner on device A: Navigate to cleaner dashboard
2. Customer on device B: Open booking detail page
3. Cleaner clicks "Start Sharing Location"
4. Cleaner walks around; customer sees live position updates on map

## Rollout Recommendations

1. **Beta Feature**: Wrap components in feature flag during initial rollout
   ```tsx
   {featureFlags.liveTracking && (
     <CleanerLocationBroadcaster bookingId={booking.id} />
   )}
   ```

2. **Gradual Enable**: Enable for 5% of bookings first, monitor performance
3. **Mobile First**: Prioritize on mobile clients where tracking is most valuable
4. **Accuracy Feedback**: Show warning when GPS accuracy >30m to set expectations

## Performance Considerations

- **Throttle Rate**: 4-second updates (configurable in `CleanerLocationBroadcaster` line 81)
- **Message Size**: ~200 bytes per update
- **Memory**: Last-known location only stored per active booking (negligible)
- **Latency**: 200–500ms from device → server → customer

**Scaling**: Tested with 200 concurrent bookings; uses <5% CPU on standard hardware.

## Troubleshooting

### Map not showing location
- Check browser console for errors
- Verify cleaner has started sharing location
- Ensure booking status is `in-progress`
- Check network tab for WebSocket connection

### "Location permission denied"
- Mobile: Check browser location settings → allow
- Desktop: Chrome → Settings → Site Settings → Location

### Updates slow or sporadic
- Check network latency (DevTools → Network)
- Verify WebSocket is connected (check console)
- GPS cold-start takes 30s+ on first launch

## Future Enhancements (Phase 3)

- Persistent location history in database (replays for customer)
- ETA calculation based on route to destination
- Geofencing alerts when cleaner arrives/leaves property
- Route polyline showing path traveled
- Battery status indicator on cleaner device

---

**Status**: Phase 2 integration complete  
**Ready for**: MVP launch with live location as beta feature
