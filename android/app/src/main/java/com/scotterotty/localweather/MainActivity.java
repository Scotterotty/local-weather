package com.scotterotty.localweather;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        super.onPause();
        // The app may have just found a new location or changed units; bring the widget up to date.
        WidgetUpdateWorker.refreshNow(this);
    }
}
