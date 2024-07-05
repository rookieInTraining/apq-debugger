<style>
    img.displayed {
        display: block;
        margin-left: auto;
        margin-right: auto;
        padding: 20px;
    }
</style>

<img src="./icons/icon128.png" class="displayed">

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


