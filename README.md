# es-domain-azure

# Contributing

## Creating a new Relase
 - Ensure all tests are passing
 - Bump the version in `package.json`
 - Create a tag, ```git tag -a v0.1.0 -m "Add some description here"```
 - Push your code and tag, ```git push --tags```
 - From GitHub, create a new release and select the tag, created from the previous step
 - Creating a release triggers a Git Action which builds and publishes the package
    - Check that the new package built and was deployed succesfull