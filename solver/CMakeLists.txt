cmake_minimum_required(VERSION 3.20)

# ===== SOLVER BUILD =====
message(STATUS "[Solver] Configuring velora_solver executable...")

set(SOLVER_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/include")
set(SOLVER_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src")

# Collect solver source files
set(SOLVER_SOURCES
    ${SOLVER_SOURCE_DIR}/main.cpp
    ${SOLVER_SOURCE_DIR}/map_distance.cpp
)

# Create executable
add_executable(velora_solver ${SOLVER_SOURCES})

# Include directories (local)
target_include_directories(velora_solver 
    PRIVATE 
        ${SOLVER_INCLUDE_DIR}
        ${CMAKE_CURRENT_BINARY_DIR}
)

# C++ standard and flags
set_target_properties(velora_solver PROPERTIES
    CXX_STANDARD 17
    CXX_STANDARD_REQUIRED ON
    CXX_EXTENSIONS OFF
)

# Find and link threads (required for std::mutex)
find_package(Threads REQUIRED)
target_link_libraries(velora_solver PRIVATE Threads::Threads)

message(STATUS "[Solver] Include dir: ${SOLVER_INCLUDE_DIR}")
message(STATUS "[Solver] Source dir: ${SOLVER_SOURCE_DIR}")

# ===== FIND & LINK DEPENDENCIES =====

# 1. nlohmann_json (required)
message(STATUS "[Solver] Searching for nlohmann_json...")
find_package(nlohmann_json QUIET)

if(nlohmann_json_FOUND)
    message(STATUS "[Solver] ✓ Found nlohmann_json via CMake")
    target_link_libraries(velora_solver PRIVATE nlohmann_json::nlohmann_json)
else()
    message(STATUS "[Solver] nlohmann_json not found via CMake, trying header-only mode...")
    # Fallback: try to find json.hpp in common locations
    find_path(NLOHMANN_JSON_INCLUDE_DIR
        NAMES nlohmann/json.hpp
        PATHS 
            /usr/include 
            /usr/local/include 
            /opt/homebrew/include
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party
        NO_DEFAULT_PATH
    )
    if(NLOHMANN_JSON_INCLUDE_DIR)
        message(STATUS "[Solver] ✓ Found nlohmann/json.hpp at ${NLOHMANN_JSON_INCLUDE_DIR}")
        target_include_directories(velora_solver PRIVATE ${NLOHMANN_JSON_INCLUDE_DIR})
    else()
        message(FATAL_ERROR "[Solver] nlohmann_json not found!\n"
                "  Install via: brew install nlohmann-json (macOS)\n"
                "               sudo apt-get install nlohmann-json3-dev (Linux)\n"
                "  Or download header from: https://github.com/nlohmann/json/releases")
    endif()
endif()

# 2. CURL (optional, for external map API support)
message(STATUS "[Solver] Searching for CURL...")
find_package(CURL QUIET)

if(CURL_FOUND)
    message(STATUS "[Solver] ✓ Found CURL at ${CURL_INCLUDE_DIRS}")
    target_compile_definitions(velora_solver PRIVATE USE_CURL)
    target_include_directories(velora_solver PRIVATE ${CURL_INCLUDE_DIRS})
    target_link_libraries(velora_solver PRIVATE ${CURL_LIBRARIES})
    message(STATUS "[Solver] External Map API support: ENABLED")
else()
    message(STATUS "[Solver] CURL not found. External Map API support: DISABLED")
    message(STATUS "[Solver] Note: Solver will use Haversine distance calculation")
endif()

# Add subdirectories for modular components (if they contain CMakeLists.txt)
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/constraints/CMakeLists.txt")
    add_subdirectory(src/constraints)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/cost/CMakeLists.txt")
    add_subdirectory(src/cost)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/heuristics/CMakeLists.txt")
    add_subdirectory(src/heuristics)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/metaheuristics/CMakeLists.txt")
    add_subdirectory(src/metaheuristics)
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/utils/CMakeLists.txt")
    add_subdirectory(src/utils)
endif()

message(STATUS "[Solver] Build target: velora_solver")
