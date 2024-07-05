<p align="center">
   <img src="./icons/icon128.png" style="padding: 20px;">
</p>

# Apollo Persisted Query Interceptor

Allows you to intercept graphql queries using Apollo's APQ feature to send graphql queries instead of sha256 hashes.

## Steps:
* Go to the target page
* Click on the extension
* Add the regex of the query to intercept (Eg. : `*graphql*`)
* Initiate the request through the web interface
* Request intercepted will trigger twice:
    * One failing due to PersistedQueryNotFound
    * The other consisting of the graphql "query" key